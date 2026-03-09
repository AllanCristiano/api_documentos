import {
  Injectable,
  BadRequestException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { createWorker } from 'tesseract.js';
import * as path from 'path';
import * as fs from 'fs';
import { promises as fsPromises } from 'fs';
import { randomBytes } from 'crypto';
import { execSync } from 'child_process';
import { Mutex } from 'async-mutex';

const DOC_TYPES = {
  portaria: {
    label: 'PORTARIA',
    pattern: /PORTARIA\s*(?:Nº|N\.º|N|NO)?\s*([\d./\s-]+)/i,
  },
  lei_ordinaria: {
    label: 'LEI',
    pattern: /LEI\s*(?:ORDIN[ÁA]RIA)?\s*(?:Nº|N\.º|N|NO)?\s*([\d.,\s-]+)/i,
  },
  lei_complementar: {
    label: 'LEI COMPLEMENTAR',
    pattern: /LEI\s+COMPLEMENTAR\s*(?:Nº|N\.º|N|NO)?\s*([\d.,\s-]+)/i,
  },
  decreto: {
    label: 'DECRETO',
    pattern: /DECRETO\s*(?:Nº|N\.º|N|NO)?\s*([\d./\s-]+)/i,
  },
};

@Injectable()
export class OcrService {
  private readonly logger = new Logger(OcrService.name);
  private readonly mutex = new Mutex();

  async processPdf(file: Express.Multer.File, docType: keyof typeof DOC_TYPES) {
    if (!file || !file.buffer) throw new BadRequestException('Arquivo ou buffer inválido.');

    return await this.mutex.runExclusive(async () => {
      try {
        this.logger.log(`Iniciando OCR: ${file.originalname}`);
        
        const rawText = await this.getTextFromPdf(file.buffer);
        const fullText = this.cleanExtractedText(rawText);
        const extractedData = this.extractInfo(fullText, docType);
        const savedFilePath = await this.saveFile(file.buffer, docType, extractedData);

        return {
          message: 'Processamento concluído com sucesso!',
          documentType: docType,
          filePath: savedFilePath,
          ...extractedData,
          fullText, 
        };
      } catch (error) {
        this.logger.error('Falha no processamento OCR:', error.message);
        throw new InternalServerErrorException('Erro técnico ao processar OCR do PDF.');
      }
    });
  }

  private async getTextFromPdf(pdfBuffer: Buffer): Promise<string> {
    const worker = await createWorker('por');
    const jobId = randomBytes(8).toString('hex');
    
    const jobDir = path.resolve('./temp_ocr_' + jobId);
    if (!fs.existsSync(jobDir)) fs.mkdirSync(jobDir, { recursive: true });

    const tempPdf = path.join(jobDir, 'input.pdf');
    fs.writeFileSync(tempPdf, pdfBuffer);

    try {
      execSync(`pdftoppm -jpeg -r 200 "${tempPdf}" "${path.join(jobDir, 'page')}"`);

      const files = fs.readdirSync(jobDir)
        .filter(f => f.endsWith('.jpg'))
        .sort((a, b) => {
          const numA = parseInt(a.match(/\d+/)?.[0] || '0');
          const numB = parseInt(b.match(/\d+/)?.[0] || '0');
          return numA - numB;
        });

      if (files.length === 0) throw new Error('Falha ao gerar imagens do PDF.');

      let combinedText = '';
      for (const f of files) {
        const imagePath = path.join(jobDir, f);
        const { data } = await worker.recognize(imagePath);
        combinedText += `\n\n${data.text}`;
      }

      return combinedText;
    } finally {
      await worker.terminate();
      if (fs.existsSync(jobDir)) {
        fs.rmSync(jobDir, { recursive: true, force: true });
      }
    }
  }

  private cleanExtractedText(text: string): string {
    return text
      .replace(/\n{3,}/g, '\n\n')
      .replace(/(\w+)-\n(\w+)/g, '$1$2')
      .replace(/(?<!\n)\n(?!\n)/g, ' ')
      .replace(/ {2,}/g, ' ')
      .trim();
  }

  /**
   * 🛡️ Higienização Cirúrgica: Remove ruídos de cabeçalhos do Diário Oficial
   */
  private sanitizeText(text: string): string {
    return text
      .replace(/DI[ÁA]RIO\s+OFICIAL/gi, '')
      .replace(/EDI[ÇC][ÃA]O\s+N[º°\.]?\s*\d+/gi, '')
      .replace(/ESTADO\s+DE\s+SERGIPE/gi, '')
      .replace(/PREFEITURA\s+MUNICIPAL\s+DE\s+ARACAJU/gi, '')
      .replace(/[=|_|Ú|À|\\|\[|\]|«|»|©]+/g, ' ') // Remove sujeira visual comum do OCR
      .replace(/\s+/g, ' ') // Normaliza espaços
      .trim();
  }

  private extractInfo(text: string, docType: keyof typeof DOC_TYPES) {
    const cleanText = text.replace(/\s+/g, ' '); 
    const config = DOC_TYPES[docType];
    
    let numero_doc = 'Não encontrado';
    let data_doc = 'Data inválida';
    let trecho_capturado = 'Ementa não encontrada.';

    // 1. Busca Número
    const numMatch = config.pattern.exec(cleanText);
    if (numMatch) {
      numero_doc = numMatch[1].trim().split(' ')[0].replace(/[^0-9./-]/g, '');
    }

    // 2. Busca Data
    const datePattern = /((?:\d{1,2}\s+de\s+[a-zA-ZçÇ]+\s+de\s+\d{4})|(?:\d{2}[./]\d{2}[./]\d{4}))/i;
    const dateMatch = datePattern.exec(cleanText);
    if (dateMatch) {
      data_doc = this.formatDate(dateMatch[1]);
    }

    // 3. Busca e Sanitização da EMENTA
    const ementaPattern = /(?:DE\s+\d{4}|202\d)[\s.,;]*([\s\S]*?)(?:A\s+PREFEITA|O\s+PREFEITO|Faço\s+saber|Art\.\s*1º)/i;
    const ementaMatch = ementaPattern.exec(cleanText);

    if (ementaMatch && ementaMatch[1].trim().length > 10) {
      // Aplicamos a higienização aqui
      let extractedEmenta = this.sanitizeText(ementaMatch[1]);
      
      // Remove repetição do título se ele aparecer no início da ementa
      const titlePattern = /(?:LEI|PORTARIA|DECRETO)\s*(?:Nº|N\.º|N|NO)?\s*[\d./-]+\s*DE\s*\d{2}\s*DE\s*[A-Z]+\s*DE\s*\d{4}/i;
      extractedEmenta = extractedEmenta.replace(titlePattern, '').trim();

      if (extractedEmenta.length > 350) {
        extractedEmenta = extractedEmenta.substring(0, 350).trim() + '...';
      }
      trecho_capturado = extractedEmenta.charAt(0).toUpperCase() + extractedEmenta.slice(1);
    } else {
      const fallbackIndex = numMatch ? numMatch.index + numMatch[0].length : 0;
      trecho_capturado = this.sanitizeText(cleanText.substring(fallbackIndex + 30, fallbackIndex + 200)) + '...';
    }

    return {
      numero_doc,
      data_doc,
      trecho_capturado,
    };
  }

  private formatDate(dateStr: string): string {
    const meses = {
      janeiro: '01', fevereiro: '02', março: '03', marco: '03', abril: '04', maio: '05', junho: '06',
      julho: '07', agosto: '08', setembro: '09', outubro: '10', novembro: '11', dezembro: '12'
    };

    let m = /(\d{1,2})\s+de\s+([a-zA-ZçÇ]+)\s+de\s+(\d{4})/i.exec(dateStr);
    if (m) {
      const mesNum = meses[m[2].toLowerCase()];
      if (mesNum) return `${m[3]}-${mesNum}-${m[1].padStart(2, '0')}`;
    }

    m = /(\d{2})[./](\d{2})[./](\d{4})/.exec(dateStr);
    if (m) return `${m[3]}-${m[2]}-${m[1]}`;

    return 'Data inválida';
  }

  private async saveFile(buffer: Buffer, docType: string, data: any): Promise<string> {
    const isError = data.numero_doc === 'Não encontrado';
    const cleanNum = data.numero_doc.replace(/[./]/g, '-');
    
    const name = isError 
      ? `FALHA_${docType}_${randomBytes(3).toString('hex')}.pdf`
      : `${docType.toUpperCase()}_${cleanNum}_${data.data_doc}.pdf`;

    const dir = path.resolve('./storage');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    
    const fullPath = path.join(dir, name);
    await fsPromises.writeFile(fullPath, buffer);
    return fullPath;
  }
}