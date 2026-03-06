import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { DocumentoService } from './documento.service';
import { StatusOcr } from './entities/documento.entity';
import { OcrService } from 'src/files/ocr.service';
import { FilesService } from 'src/files/files.service';

// 🔧 CONFIGURAÇÃO DO WORKER ATUALIZADA
@Processor('ocr-queue', {
  concurrency: 1, // Processa 1 arquivo por vez para não estourar a RAM do servidor
  lockDuration: 300000, // 5 minutos de trava. Tempo de sobra pro Tesseract mastigar arquivos gigantes.
})
export class OcrProcessor extends WorkerHost {
  private readonly logger = new Logger(OcrProcessor.name);

  constructor(
    private readonly documentoService: DocumentoService,
    private readonly ocrService: OcrService,
    private readonly filesService: FilesService,
  ) {
    super();
  }

  async process(job: Job<any, any, string>): Promise<any> {
    const { documentoId, tipo, arquivoUrl } = job.data;
    
    this.logger.log(`[JOB ${job.id}] Iniciando OCR do documento ID: ${documentoId}`);

    try {
      // 1. Atualiza o status no banco para PROCESSANDO
      await this.documentoService.atualizarDadosOcr(documentoId, { 
        status_ocr: StatusOcr.PROCESSANDO 
      });

      // -------------------------------------------------------------------------
      // 🔧 CORREÇÃO AQUI: Extrair a "Key" (caminho) da URL completa.
      // O MinIO espera algo como "PORTARIA/arquivo.pdf", não a URL "http://..."
      // -------------------------------------------------------------------------
      const urlParts = arquivoUrl.split('atos-normativos/');
      const objectKey = urlParts.length > 1 ? urlParts[1] : arquivoUrl;

      // 2. Baixa o PDF usando a Key correta
      const fileBuffer = await this.filesService.downloadFileFromMinio(objectKey);

      // 3. Monta um arquivo no formato que o seu OcrService espera (Multer)
      const fakeMulterFile = {
        buffer: fileBuffer,
        originalname: objectKey.split('/').pop(),
        mimetype: 'application/pdf',
      } as Express.Multer.File;

      // 4. Normaliza o tipo de documento
      const serviceDocType = tipo.toLowerCase();

      // 5. Executa o processamento OCR
      const resultadoOcr = await this.ocrService.processPdf(fakeMulterFile, serviceDocType as any);

      // 6. Atualiza o banco com os dados extraídos
      await this.documentoService.atualizarDadosOcr(documentoId, {
        number: resultadoOcr.numero_doc,
        date: resultadoOcr.data_doc,
        title: `${tipo} ${resultadoOcr.numero_doc || ''}`.trim(), 
        description: resultadoOcr.trecho_capturado,
        fullText: resultadoOcr.fullText,
        status_ocr: StatusOcr.CONCLUIDO,
      });

      this.logger.log(`[JOB ${job.id}] OCR Finalizado com sucesso para ID: ${documentoId}`);
      
      return resultadoOcr;

    } catch (error) {
      this.logger.error(`[JOB ${job.id}] Falha brutal no OCR para ID: ${documentoId}`, error.stack);
      
      // Salva a mensagem de erro no banco para feedback na UI
      await this.documentoService.atualizarDadosOcr(documentoId, { 
        status_ocr: StatusOcr.ERRO,
        mensagem_erro: error.message 
      });

      throw error; 
    }
  }
}