import {
  Injectable,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { createWorker } from 'tesseract.js';
import * as path from 'path';
import * as fs from 'fs';
import { randomBytes } from 'crypto';
import { execSync } from 'child_process';

// Tipos de documentos e suas configurações de regex
const DOC_TYPES = {
  portaria: {
    pattern:
      /PORTARIA\s+N\.?[º°o]?\s*([\d./]+)\s*DE\s+((?:\d{1,2}\s+de\s+\w+\s+de\s+\d{4})|(?:\d{2}\.\d{2}\.\d{4}))/i,
  },
  lei: {
    pattern:
      /LEI(?:\s+COMPLEMENTAR)?\s+N\.?\s*[º°o]?\s*([\d.,]+)\s*DE\s+(\d{1,2}\s+de\s+\w+\s+de\s+\d{4})/i,
  },
  decreto: {
    pattern:
      /DECRETO\s+N\.?\s*[º°o]?\s*([\d.,]+)\s+DE\s+(\d{1,2}\s+de\s+\w+\s+de\s+\d{4})/i,
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

      return {
        documentType: docType,
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

  private async getTextFromPdf(pdfBuffer: Buffer): Promise<string> {
    const worker = await createWorker('por');
    let fullText = '';

    const tempDir = path.join(__dirname, 'temp_pages');
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);

    const tempPdfPath = path.join(
      tempDir,
      `${randomBytes(16).toString('hex')}.pdf`,
    );
    fs.writeFileSync(tempPdfPath, pdfBuffer);

    try {
      const outputPrefix = path.join(tempDir, 'page');
      const command = `pdftoppm -jpeg -r 300 "${tempPdfPath}" "${outputPrefix}"`;
      console.log(`Executando comando: ${command}`);
      execSync(command);

      const imageFiles = fs
        .readdirSync(tempDir)
        .filter((f) => f.endsWith('.jpg'));

      for (const imageFile of imageFiles) {
        const imagePath = path.join(tempDir, imageFile);
        console.log(`Processando a imagem ${imageFile}...`);
        const {
          data: { text },
        } = await worker.recognize(imagePath);
        const pageNumber = imageFile.match(/page-(\d+)/)?.[1] || '?';
        fullText += `--- Página ${pageNumber} ---\n${text}\n\n`;
      }
    } finally {
      await worker.terminate();
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    }

    return fullText;
  }

  private extractInfo(text: string, pattern: RegExp) {
    const headerText = text.substring(0, 1500);
    const match = headerText.match(pattern);

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
      janeiro: '01',
      fevereiro: '02',
      março: '03',
      abril: '04',
      maio: '05',
      junho: '06',
      julho: '07',
      agosto: '08',
      setembro: '09',
      outubro: '10',
      novembro: '11',
      dezembro: '12',
    };

    // 1. Tenta o formato "DD de MÊS de AAAA"
    let match = dateText.match(/(\d{1,2})\s+de\s+(\w+)\s+de\s+(\d{4})/i);
    if (match) {
      const [, dia, mes, ano] = match;
      const mesNome = mes.toLowerCase();
      if (meses[mesNome]) {
        return `${ano}-${meses[mesNome]}-${dia.padStart(2, '0')}`;
      }
    }

    // 2. Se falhar, tenta o formato "DD.MM.AAAA"
    match = dateText.match(/(\d{2})\.(\d{2})\.(\d{4})/);
    if (match) {
      const [, dia, mes, ano] = match;
      return `${ano}-${mes}-${dia}`;
    }

    return 'Data inválida';
  }

  private getSnippet(text: string, startIndex = 0): string {
    const content = text.substring(startIndex).trim();
    return content.split(/\s+/).slice(0, 30).join(' ') + '...';
  }
}
