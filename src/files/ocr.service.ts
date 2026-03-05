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

// Tipos de documentos e suas configurações de regex otimizadas
const DOC_TYPES = {
  portaria: {
    pattern:
      /PORTARIA\s+N[º°o.]?\s*([\d./]+)\s+DE\s+((?:\d{1,2}\s+de\s+\w+\s+de\s+\d{4})|(?:\d{2}[./]\d{2}[./]\d{4}))/i,
  },
  lei_ordinaria: {
    pattern:
      /LEI\s+N[º°o.]?\s*([\d.,]+)\s+DE\s+(\d{1,2}\s+de\s+\w+\s+de\s+\d{4})/i,
  },
  lei_complementar: {
    pattern:
      /LEI\s+COMPLEMENTAR\s+N[º°o.]?\s*([\d.,]+)\s+DE\s+(\d{1,2}\s+de\s+\w+\s+de\s+\d{4})/i,
  },
  decreto: {
    pattern:
      /DECRETO\s+N[º°o.]?\s*([\d./]+)\s+DE\s+((?:\d{1,2}\s+de\s+\w+\s+de\s+\d{4})|(?:\d{2}[./]\d{2}[./]\d{4}))/i,
  },
};

@Injectable()
export class OcrService {
  async processPdf(file: Express.Multer.File, docType: keyof typeof DOC_TYPES) {
    if (!file) {
      throw new BadRequestException('Nenhum arquivo enviado.');
    }
    if (!DOC_TYPES[docType]) {
      throw new BadRequestException(`Tipo de documento inválido: ${docType}`);
    }

    try {
      console.log('Iniciando OCR...');
      const fullText = await this.getTextFromPdf(file.buffer);
      console.log('OCR concluído. Extraindo informações...');

      const extractedData = this.extractInfo(
        fullText,
        DOC_TYPES[docType].pattern,
      );
      console.log('Extração concluída.');

      const savedFilePath = await this.saveFile(
        file.buffer,
        docType,
        extractedData,
      );

      return {
        message: 'Arquivo processado e salvo com sucesso!',
        documentType: docType,
        filePath: savedFilePath,
        ...extractedData,
        fullText,
      };
    } catch (error: any) {
      console.error('Erro no processamento do OCR:', error);
      throw new InternalServerErrorException(
        'Falha ao processar o arquivo PDF.',
      );
    }
  }

  private async saveFile(
    originalFileBuffer: Buffer,
    docType: string,
    extractedData: { numero_doc: string; data_doc: string },
  ): Promise<string> {
    let newFileName: string;

    if (
      extractedData.numero_doc === 'Não encontrado' ||
      extractedData.data_doc === 'Data inválida'
    ) {
      const randomName = randomBytes(8).toString('hex');
      const datePrefix = new Date().toISOString().split('T')[0];
      newFileName = `${datePrefix}_${docType}_OCR-FALHOU_${randomName}.pdf`;
      console.warn(
        'Dados não encontrados no OCR. Salvando com nome de arquivo alternativo:',
        newFileName,
      );
    } else {
      const sanitizedDocNumber = extractedData.numero_doc.replace(/[/ ]/g, '-');
      newFileName = `${sanitizedDocNumber.replace(/,/g, '')}_${extractedData.data_doc}.pdf`;
    }

    const saveDir = path.join(__dirname, '..', '..', 'storage');
    const filePath = path.join(saveDir, newFileName);

    if (!fs.existsSync(saveDir)) {
      fs.mkdirSync(saveDir, { recursive: true });
    }

    await fsPromises.writeFile(filePath, originalFileBuffer);
    console.log(`Arquivo salvo com sucesso em: ${filePath}`);

    return filePath;
  }

  private async getTextFromPdf(pdfBuffer: Buffer): Promise<string> {
    const worker = await createWorker('por');
    let fullText = '';

    const baseTempDir = path.join(__dirname, 'temp_pages');
    if (!fs.existsSync(baseTempDir)) {
      fs.mkdirSync(baseTempDir, { recursive: true });
    }

    const jobId = randomBytes(16).toString('hex');
    const jobTempDir = path.join(baseTempDir, jobId);
    fs.mkdirSync(jobTempDir);

    const tempPdfPath = path.join(jobTempDir, `${jobId}.pdf`);
    fs.writeFileSync(tempPdfPath, pdfBuffer);

    try {
      const outputPrefix = path.join(jobTempDir, 'page');
      // Comando pdftoppm gera page-1.jpg, page-2.jpg...
      const command = `pdftoppm -jpeg -r 300 "${tempPdfPath}" "${outputPrefix}"`;
      console.log(`Executando comando: ${command}`);
      execSync(command);

      const imageFiles = fs
        .readdirSync(jobTempDir)
        .filter((f) => f.endsWith('.jpg'))
        .sort((a, b) => {
          // Ordenação numérica para garantir page-2 antes de page-10
          const numA = parseInt(/page-(\d+)/.exec(a)?.[1] || '0');
          const numB = parseInt(/page-(\d+)/.exec(b)?.[1] || '0');
          return numA - numB;
        });

      for (const imageFile of imageFiles) {
        const imagePath = path.join(jobTempDir, imageFile);
        console.log(`Processando a imagem ${jobId}/${imageFile}...`);
        const {
          data: { text },
        } = await worker.recognize(imagePath);
        
        const pageNumber = /page-(\d+)/.exec(imageFile)?.[1] || '?';
        fullText += `--- Página ${pageNumber} ---\n${text}\n\n`;
      }
    } finally {
      await worker.terminate();
      if (fs.existsSync(jobTempDir)) {
        fs.rmSync(jobTempDir, { recursive: true, force: true });
      }
    }

    return fullText;
  }

  private extractInfo(text: string, pattern: RegExp) {
    // Aumentamos levemente a margem de busca para garantir captura em documentos longos
    const headerText = text.substring(0, 4000);
    const match = pattern.exec(headerText);

    if (!match) {
      return {
        numero_doc: 'Não encontrado',
        data_doc: 'Não encontrada',
        trecho_capturado: this.getSnippet(text),
      };
    }

    const numero_doc = match[1]?.trim() || 'Não encontrado';
    const rawDate = match[2]?.trim() || '';
    const matchEndIndex = (match.index ?? 0) + (match[0]?.length ?? 0);

    return {
      numero_doc,
      data_doc: this.formatDate(rawDate),
      trecho_capturado: this.getSnippet(text, matchEndIndex),
    };
  }

  private formatDate(dateText: string): string {
    const meses = {
      janeiro: '01', fevereiro: '02', março: '03', abril: '04',
      maio: '05', junho: '06', julho: '07', agosto: '08',
      setembro: '09', outubro: '10', novembro: '11', dezembro: '12',
    };

    // Formato: 04 de Março de 2022
    let match = /(\d{1,2})\s+de\s+(\w+)\s+de\s+(\d{4})/i.exec(dateText);
    if (match) {
      const [, dia, mes, ano] = match;
      const mesNome = mes.toLowerCase();
      if (meses[mesNome]) {
        return `${ano}-${meses[mesNome]}-${dia.padStart(2, '0')}`;
      }
    }

    // Formato: 04.03.2022 ou 04/03/2022
    match = /(\d{2})[./](\d{2})[./](\d{4})/.exec(dateText);
    if (match) {
      const [, dia, mes, ano] = match;
      return `${ano}-${mes}-${dia}`;
    }

    return 'Data inválida';
  }

  private getSnippet(text: string, startIndex = 0): string {
    const content = text.substring(startIndex).trim();
    return content.split(/\s+/).slice(0, 50).join(' ') + '...';
  }
}