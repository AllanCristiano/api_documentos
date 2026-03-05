import {
  Injectable,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { createWorker } from 'tesseract.js';
import * as path from 'path';
import * as fs from 'fs';
import { promises as fsPromises } from 'fs';
import { randomBytes } from 'crypto';
import { execSync } from 'child_process';

// Regex ultra-flexíveis para lidar com variações de OCR
const DOC_TYPES = {
  portaria: {
    // Busca "PORTARIA", pula qualquer coisa até o número, pula qualquer coisa até "DE", captura a data
    pattern: /PORTARIA\s+N[^\d]*\s*([\d./]+).*?DE\s+((?:\d{1,2}\s+de\s+\w+\s+de\s+\d{4})|(?:\d{2}[./]\d{2}[./]\d{4}))/i,
  },
  lei_ordinaria: {
    pattern: /LEI\s+N[^\d]*\s*([\d.,]+).*?DE\s+(\d{1,2}\s+de\s+\w+\s+de\s+\d{4})/i,
  },
  lei_complementar: {
    pattern: /LEI\s+COMPLEMENTAR\s+N[^\d]*\s*([\d.,]+).*?DE\s+(\d{1,2}\s+de\s+\w+\s+de\s+\d{4})/i,
  },
  decreto: {
    // O .*? permite que existam quebras de linha ou textos entre o número e a data
    pattern: /DECRETO\s+N[^\d]*\s*([\d./]+).*?DE\s+((?:\d{1,2}\s+de\s+\w+\s+de\s+\d{4})|(?:\d{2}[./]\d{2}[./]\d{4}))/i,
  },
};

@Injectable()
export class OcrService {
  async processPdf(file: Express.Multer.File, docType: keyof typeof DOC_TYPES) {
    if (!file) throw new BadRequestException('Nenhum arquivo enviado.');
    if (!DOC_TYPES[docType]) throw new BadRequestException(`Tipo inválido: ${docType}`);

    try {
      console.log('Iniciando OCR...');
      const fullText = await this.getTextFromPdf(file.buffer);
      console.log('Extraindo informações...');

      const extractedData = this.extractInfo(fullText, DOC_TYPES[docType].pattern);

      const savedFilePath = await this.saveFile(file.buffer, docType, extractedData);

      return {
        message: 'Processado com sucesso!',
        documentType: docType,
        filePath: savedFilePath,
        ...extractedData,
        fullText,
      };
    } catch (error) {
      console.error('Erro OCR:', error);
      throw new InternalServerErrorException('Falha ao processar PDF.');
    }
  }

  private async saveFile(
    buffer: Buffer,
    docType: string,
    data: { numero_doc: string; data_doc: string },
  ): Promise<string> {
    const isFallible = data.numero_doc === 'Não encontrado' || data.data_doc === 'Data inválida';
    const fileName = isFallible
      ? `${new Date().toISOString().split('T')[0]}_${docType}_FALHOU_${randomBytes(4).toString('hex')}.pdf`
      : `${data.numero_doc.replace(/[/ ]/g, '-')}_${data.data_doc}.pdf`;

    const saveDir = path.join(__dirname, '..', '..', 'storage');
    if (!fs.existsSync(saveDir)) fs.mkdirSync(saveDir, { recursive: true });

    const filePath = path.join(saveDir, fileName);
    await fsPromises.writeFile(filePath, buffer);
    return filePath;
  }

  private async getTextFromPdf(pdfBuffer: Buffer): Promise<string> {
    const worker = await createWorker('por');
    const jobId = randomBytes(8).toString('hex');
    const jobDir = path.join(__dirname, 'temp', jobId);
    
    fs.mkdirSync(jobDir, { recursive: true });
    const tempPdf = path.join(jobDir, 'input.pdf');
    fs.writeFileSync(tempPdf, pdfBuffer);

    try {
      // Gera imagens das páginas
      execSync(`pdftoppm -jpeg -r 300 "${tempPdf}" "${path.join(jobDir, 'page')}"`);
      
      const files = fs.readdirSync(jobDir).filter(f => f.endsWith('.jpg')).sort();
      let text = '';
      
      for (const f of files) {
        const { data } = await worker.recognize(path.join(jobDir, f));
        text += `\n${data.text}`;
      }
      return text;
    } finally {
      await worker.terminate();
      fs.rmSync(jobDir, { recursive: true, force: true });
    }
  }

  private extractInfo(text: string, pattern: RegExp) {
    // Remove quebras de linha excessivas para a Regex não se perder
    const singleLineText = text.replace(/\r?\n|\r/g, ' ').replace(/\s+/g, ' ');
    
    // Busca nos primeiros 3000 caracteres
    const match = pattern.exec(singleLineText);

    if (!match) {
      return {
        numero_doc: 'Não encontrado',
        data_doc: 'Data inválida',
        trecho_capturado: text.substring(0, 500).trim() + '...',
      };
    }

    return {
      numero_doc: match[1].trim(),
      data_doc: this.formatDate(match[2].trim()),
      trecho_capturado: this.getSnippet(singleLineText, match.index),
    };
  }

  private formatDate(dateStr: string): string {
    const meses = {
      janeiro: '01', fevereiro: '02', março: '03', abril: '04', maio: '05', junho: '06',
      julho: '07', agosto: '08', setembro: '09', outubro: '10', novembro: '11', dezembro: '12'
    };

    // Tenta formato "04 de março de 2022"
    let m = /(\d{1,2})\s+de\s+(\w+)\s+de\s+(\d{4})/i.exec(dateStr);
    if (m) {
      const mesNum = meses[m[2].toLowerCase()];
      if (mesNum) return `${m[3]}-${mesNum}-${m[1].padStart(2, '0')}`;
    }

    // Tenta formato "04.03.2022" ou "04/03/2022"
    m = /(\d{2})[./](\d{2})[./](\d{4})/.exec(dateStr);
    if (m) return `${m[3]}-${m[2]}-${m[1]}`;

    return 'Data inválida';
  }

  private getSnippet(text: string, index: number): string {
    return text.substring(index, index + 500).trim() + '...';
  }
}