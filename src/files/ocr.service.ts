import {
  Injectable,
  BadRequestException,
  InternalServerErrorException,
  ServiceUnavailableException, // Novo erro para quando a fila estiver cheia (opcional)
} from '@nestjs/common';
import { createWorker } from 'tesseract.js';
import * as path from 'path';
import * as fs from 'fs';
import { promises as fsPromises } from 'fs';
import { randomBytes } from 'crypto';
import { execSync } from 'child_process';
import { Mutex } from 'async-mutex'; // Importação da trava

const DOC_TYPES = {
  portaria: {
    label: 'PORTARIA',
    pattern: /PORTARIA\s+N[^\d]*\s*([\d./-]+)/i,
  },
  lei_ordinaria: {
    label: 'LEI',
    pattern: /LEI\s+N[^\d]*\s*([\d.,-]+)/i,
  },
  lei_complementar: {
    label: 'LEI\s+COMPLEMENTAR',
    pattern: /LEI\s+COMPLEMENTAR\s+N[^\d]*\s*([\d.,-]+)/i,
  },
  decreto: {
    label: 'DECRETO',
    pattern: /DECRETO\s+N[^\d]*\s*([\d./-]+)/i,
  },
};

@Injectable()
export class OcrService {
  // Criamos uma instância de Mutex que persistirá enquanto o serviço estiver vivo
  private readonly mutex = new Mutex();

  async processPdf(file: Express.Multer.File, docType: keyof typeof DOC_TYPES) {
    if (!file) throw new BadRequestException('Arquivo não enviado.');

    // O código abaixo só será executado quando o Mutex estiver liberado
    // Se outro processo estiver rodando, ele aguarda aqui (await)
    return await this.mutex.runExclusive(async () => {
      try {
        console.log(`[${new Date().toLocaleTimeString()}] Iniciando OCR (Processo exclusivo)...`);
        const fullText = await this.getTextFromPdf(file.buffer);
        
        console.log('Extraindo dados...');
        const extractedData = this.extractInfo(fullText, docType);

        const savedFilePath = await this.saveFile(file.buffer, docType, extractedData);

        console.log(`[${new Date().toLocaleTimeString()}] Finalizado.`);
        return {
          message: 'Processado!',
          documentType: docType,
          filePath: savedFilePath,
          ...extractedData,
          fullText,
        };
      } catch (error) {
        console.error('Erro no processamento exclusivo:', error);
        throw new InternalServerErrorException('Erro ao processar o OCR.');
      }
    });
  }

  private async getTextFromPdf(pdfBuffer: Buffer): Promise<string> {
    const worker = await createWorker('por');
    const jobId = randomBytes(8).toString('hex');
    const jobDir = path.join(__dirname, 'temp', jobId);
    fs.mkdirSync(jobDir, { recursive: true });

    const tempPdf = path.join(jobDir, 'input.pdf');
    fs.writeFileSync(tempPdf, pdfBuffer);

    try {
      execSync(`pdftoppm -jpeg -r 300 "${tempPdf}" "${path.join(jobDir, 'page')}"`);
      const files = fs.readdirSync(jobDir).filter(f => f.endsWith('.jpg')).sort((a, b) => {
          const numA = parseInt(a.match(/\d+/)?.[0] || '0');
          const numB = parseInt(b.match(/\d+/)?.[0] || '0');
          return numA - numB;
      });
      
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

  private extractInfo(text: string, docType: keyof typeof DOC_TYPES) {
    const cleanText = text.replace(/\r?\n|\r/g, ' ').replace(/\s+/g, ' ');
    const header = cleanText.substring(0, 2000);

    const config = DOC_TYPES[docType];
    let numero_doc = 'Não encontrado';
    let data_doc = 'Data inválida';

    const numMatch = config.pattern.exec(header);
    if (numMatch) {
      numero_doc = numMatch[1].trim().replace(/[.]$/, '');
    }

    const datePattern = /((?:\d{1,2}\s+de\s+\w+\s+de\s+\d{4})|(?:\d{2}[./]\d{2}[./]\d{4}))/i;
    const dateMatch = datePattern.exec(header);
    if (dateMatch) {
      data_doc = this.formatDate(dateMatch[1]);
    }

    return {
      numero_doc,
      data_doc,
      trecho_capturado: this.getSnippet(cleanText, numMatch?.index || 0),
    };
  }

  private formatDate(dateStr: string): string {
    const meses = {
      janeiro: '01', fevereiro: '02', março: '03', marco: '03', abril: '04', maio: '05', junho: '06',
      julho: '07', agosto: '08', setembro: '09', outubro: '10', novembro: '11', dezembro: '12'
    };

    let m = /(\d{1,2})\s+de\s+(\w+)\s+de\s+(\d{4})/i.exec(dateStr);
    if (m) {
      const mesNome = m[2].toLowerCase();
      const mesNum = meses[mesNome];
      if (mesNum) return `${m[3]}-${mesNum}-${m[1].padStart(2, '0')}`;
    }

    m = /(\d{2})[./](\d{2})[./](\d{4})/.exec(dateStr);
    if (m) return `${m[3]}-${m[2]}-${m[1]}`;

    return 'Data inválida';
  }

  private getSnippet(text: string, index: number): string {
    return text.substring(index, index + 600).trim() + '...';
  }

  private async saveFile(buffer: Buffer, docType: string, data: any): Promise<string> {
    const isError = data.numero_doc === 'Não encontrado';
    const name = isError 
      ? `FALHA_${docType}_${randomBytes(3).toString('hex')}.pdf`
      : `${data.numero_doc.replace(/[./]/g, '-')}_${data.data_doc}.pdf`;

    const dir = path.join(__dirname, '..', '..', 'storage');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    
    const fullPath = path.join(dir, name);
    await fsPromises.writeFile(fullPath, buffer);
    return fullPath;
  }
}