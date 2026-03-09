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
        const rawText = await this.getTextFromPdf(file.buffer);
        
        // 2. Limpeza básica para o texto completo salvo no banco
        const fullText = this.cleanExtractedText(rawText);
        
        // 3. Extração de metadados (Número, Data e Ementa)
        const extractedData = this.extractInfo(fullText, docType);

        // 4. Salvamento do arquivo físico no storage local
        const savedFilePath = await this.saveFile(file.buffer, docType, extractedData);

        return {
          message: 'Processamento concluído com sucesso!',
          documentType: docType,
          filePath: savedFilePath,
          ...extractedData,
          fullText, // O texto completo limpo vai para o campo 'fullText'
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
      // Converte PDF para Imagem
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
        combinedText += `\n\n${data.text}`; // Pula linha entre páginas
      }

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

  // Limpa o texto das sujeiras de quebra de linha do PDF
  private cleanExtractedText(text: string): string {
    return text
      .replace(/\n{3,}/g, '\n\n') // Múltiplas quebras viram apenas parágrafos
      .replace(/(\w+)-\n(\w+)/g, '$1$2') // Remove hifens de fim de linha
      .replace(/(?<!\n)\n(?!\n)/g, ' ') // Quebras de linha únicas viram espaço
      .replace(/ {2,}/g, ' ') // Remove espaços múltiplos
      .trim();
  }

  private extractInfo(text: string, docType: keyof typeof DOC_TYPES) {
    const cleanText = text.replace(/\s+/g, ' '); // Uma única linha para facilitar os Regex
    const config = DOC_TYPES[docType];
    
    let numero_doc = 'Não encontrado';
    let data_doc = 'Data inválida';
    let trecho_capturado = 'Ementa não encontrada.'; // Fallback

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

    // 3. 🔧 NOVO: Busca específica da EMENTA (Resumo)
    // Tenta pegar tudo que está DEPOIS do ano (ex: "...DE 2025") e ANTES de "A PREFEITA", "O PREFEITO" ou "Faço saber"
    const ementaPattern = /(?:DE\s+\d{4}|202\d)[\s.,;]*([\s\S]*?)(?:A\s+PREFEITA|O\s+PREFEITO|Faço\s+saber|Art\.\s*1º)/i;
    const ementaMatch = ementaPattern.exec(cleanText);

    if (ementaMatch && ementaMatch[1].trim().length > 10) {
      let extractedEmenta = ementaMatch[1].trim();
      
      // Limita a um tamanho seguro (ex: max 300 caracteres) caso o padrão falhe e puxe texto demais
      if (extractedEmenta.length > 300) {
          extractedEmenta = extractedEmenta.substring(0, 300).trim() + '...';
      }
      trecho_capturado = extractedEmenta;
    } else {
      // Fallback de segurança: Se a regex da ementa falhar, pega um trecho muito curto (150 chars) após o número
      const fallbackIndex = numMatch ? numMatch.index + numMatch[0].length : 0;
      trecho_capturado = cleanText.substring(fallbackIndex + 30, fallbackIndex + 180).trim() + '...';
    }

    return {
      numero_doc,
      data_doc,
      trecho_capturado, // Envia a ementa limpa e concisa
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