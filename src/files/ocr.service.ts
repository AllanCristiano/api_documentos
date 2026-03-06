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
        
        // 1. Extração do texto via OCR
        const fullText = await this.getTextFromPdf(file.buffer);
        
        // 2. Extração de metadados (Regex)
        const extractedData = this.extractInfo(fullText, docType);

        // 3. Salvamento do arquivo físico no storage local
        const savedFilePath = await this.saveFile(file.buffer, docType, extractedData);

        return {
          message: 'Processamento concluído com sucesso!',
          documentType: docType,
          filePath: savedFilePath,
          ...extractedData,
          fullText, // Aqui retorna o texto completo lido do papel
        };
      } catch (error) {
        this.logger.error('Falha no processamento OCR:', error.message);
        throw new InternalServerErrorException('Erro técnico ao processar OCR do PDF.');
      }
    });
  }

  private async getTextFromPdf(pdfBuffer: Buffer): Promise<string> {
    const worker = await createWorker('por'); // Português
    const jobId = randomBytes(8).toString('hex');
    
    // Pasta temporária fora da build para evitar permissões restritas
    const jobDir = path.resolve('./temp_ocr_' + jobId);
    if (!fs.existsSync(jobDir)) fs.mkdirSync(jobDir, { recursive: true });

    const tempPdf = path.join(jobDir, 'input.pdf');
    fs.writeFileSync(tempPdf, pdfBuffer);

    try {
      // Converte PDF para Imagem (200 DPI é o ideal para velocidade/precisão em papel)
      // Certifique-se que o poppler-utils (pdftoppm) está instalado no SO
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
        combinedText += `\n${data.text}`;
      }

      // Verificação de segurança: se o OCR falhar e não ler nada
      if (!combinedText.trim()) {
        this.logger.warn('Aviso: OCR finalizou mas o texto extraído está vazio.');
      }

      return combinedText;
    } finally {
      await worker.terminate();
      if (fs.existsSync(jobDir)) {
        fs.rmSync(jobDir, { recursive: true, force: true });
      }
    }
  }

  private extractInfo(text: string, docType: keyof typeof DOC_TYPES) {
    // Limpeza para facilitar o Regex (remove quebras de linha mas mantém o texto íntegro)
    const cleanText = text.replace(/\r?\n|\r/g, ' ').replace(/\s+/g, ' ');
    const config = DOC_TYPES[docType];
    
    let numero_doc = 'Não encontrado';
    let data_doc = 'Data inválida';

    // 1. Busca Número (mais flexível para erros de OCR em papel)
    const numMatch = config.pattern.exec(cleanText);
    if (numMatch) {
      // Pega o primeiro grupo e limpa caracteres residuais comuns do OCR
      numero_doc = numMatch[1].trim().split(' ')[0].replace(/[^0-9./-]/g, '');
    }

    // 2. Busca Data (Padrão: dd de Mês de aaaa ou dd/mm/aaaa)
    const datePattern = /((?:\d{1,2}\s+de\s+[a-zA-ZçÇ]+\s+de\s+\d{4})|(?:\d{2}[./]\d{2}[./]\d{4}))/i;
    const dateMatch = datePattern.exec(cleanText);
    
    if (dateMatch) {
      data_doc = this.formatDate(dateMatch[1]);
    }

    return {
      numero_doc,
      data_doc,
      trecho_capturado: cleanText.substring(0, 1000).trim() + '...', 
    };
  }

  private formatDate(dateStr: string): string {
    const meses = {
      janeiro: '01', fevereiro: '02', março: '03', marco: '03', abril: '04', maio: '05', junho: '06',
      julho: '07', agosto: '08', setembro: '09', outubro: '10', novembro: '11', dezembro: '12'
    };

    // Tenta formato por extenso
    let m = /(\d{1,2})\s+de\s+([a-zA-ZçÇ]+)\s+de\s+(\d{4})/i.exec(dateStr);
    if (m) {
      const mesNum = meses[m[2].toLowerCase()];
      if (mesNum) return `${m[3]}-${mesNum}-${m[1].padStart(2, '0')}`;
    }

    // Tenta formato numérico
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

    // Salva na pasta 'storage' na raiz do projeto
    const dir = path.resolve('./storage');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    
    const fullPath = path.join(dir, name);
    await fsPromises.writeFile(fullPath, buffer);
    return fullPath;
  }
}