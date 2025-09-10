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

// Tipos de documentos e suas configurações de regex
const DOC_TYPES = {
  // NOTA: A complexidade desta regex foi apontada pelo SonarLint.
  // Para este caso de uso específico, ela é aceitável, mas pode ser otimizada se causar lentidão.
  portaria: {
    pattern:
      /PORTARIA\s+N\.?[º°o]?\s*([\d./]+)\s*DE\s+((?:\d{1,2}\s+de\s+\w+\s+de\s+\d{4})|(?:\d{2}\.\d{2}\.\d{4}))/i,
  },
  lei_ordinaria: {
    pattern:
      /LEI\s+N\.?\s*[º°o]?\s*([\d.,]+)\s*DE\s+(\d{1,2}\s+de\s+\w+\s+de\s+\d{4})/i,
  },
  lei_complementar: {
    pattern:
      /LEI\s+COMPLEMENTAR\s+N\.?\s*[º°o]?\s*([\d.,]+)\s*DE\s+(\d{1,2}\s+de\s+\w+\s+de\s+\d{4})/i,
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

      // Salva o arquivo com o novo nome
      const savedFilePath = await this.saveFile(
        // FIX: Argumentos formatados em múltiplas linhas (Prettier)
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

    // FIX: Condição formatada em múltiplas linhas (Prettier)
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
      // FIX: Removido escape desnecessário de '\/' para '/'. (ESLint/SonarLint)
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
        // FIX: Trocado 'match' por 'exec' (SonarLint)
        const pageNumber = /page-(\d+)/.exec(imageFile)?.[1] || '?';
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
    const headerText = text.substring(0, 3000);
    // FIX: Trocado 'match' por 'exec' (SonarLint)
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

    // FIX: Trocado 'match' por 'exec' (SonarLint)
    let match = /(\d{1,2})\s+de\s+(\w+)\s+de\s+(\d{4})/i.exec(dateText);
    if (match) {
      const [, dia, mes, ano] = match;
      const mesNome = mes.toLowerCase();
      if (meses[mesNome]) {
        return `${ano}-${meses[mesNome]}-${dia.padStart(2, '0')}`;
      }
    }

    // FIX: Trocado 'match' por 'exec' (SonarLint)
    match = /(\d{2})\.(\d{2})\.(\d{4})/.exec(dateText);
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
