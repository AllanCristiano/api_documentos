import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger, Inject, forwardRef } from '@nestjs/common';
import { DocumentoService } from './documento.service';
import { StatusOcr } from './entities/documento.entity';
import { OcrService } from '../files/ocr.service';
import { FilesService } from '../files/files.service';

@Processor('ocr-queue', {
  concurrency: 1, 
  lockDuration: 300000, // 5 minutos de trava para processos longos
})
export class OcrProcessor extends WorkerHost {
  private readonly logger = new Logger(OcrProcessor.name);

  constructor(
    @Inject(forwardRef(() => DocumentoService))
    private readonly documentoService: DocumentoService,
    private readonly ocrService: OcrService,
    private readonly filesService: FilesService,
  ) {
    super();
  }

  async process(job: Job<any, any, string>): Promise<any> {
    const { documentoId, tipo, arquivoUrl } = job.data;
    
    this.logger.log(`[JOB ${job.id}] 🚀 Iniciando OCR do documento ID: ${documentoId}`);

    try {
      // 1. Atualizar status para processando
      await this.documentoService.atualizarDadosOcr(documentoId, { 
        status_ocr: StatusOcr.PROCESSANDO 
      });

      // 2. Extração da Object Key (Caminho relativo no MinIO)
      // O erro XMinioInvalidObjectName ocorre porque o MinIO não aceita "http://..." como nome de objeto.
      // Precisamos apenas do que vem após o nome do bucket.
      const bucketName = 'atos-normativos'; 
      const marker = `${bucketName}/`;
      
      let objectKey = arquivoUrl;
      if (arquivoUrl.includes(marker)) {
        objectKey = arquivoUrl.split(marker)[1];
      }

      this.logger.debug(`[JOB ${job.id}] 🎯 Key extraída: ${objectKey}`);

      // 3. Download do Buffer do MinIO
      const fileBuffer = await this.filesService.downloadFileFromMinio(objectKey);

      if (!fileBuffer || fileBuffer.length === 0) {
        throw new Error(`Falha ao obter conteúdo do arquivo para a key: ${objectKey}`);
      }

      // 4. Mock do Multer File para o OcrService
      const fakeMulterFile = {
        buffer: fileBuffer,
        originalname: objectKey.split('/').pop(),
        mimetype: 'application/pdf',
      } as Express.Multer.File;

      // 5. Normalizar o tipo de documento para o switch do OCR
      const serviceDocType = tipo.toLowerCase() as any;

      // 6. Processamento OCR (Tesseract + pdftoppm)
      this.logger.log(`[JOB ${job.id}] ⏳ Extraindo texto das imagens...`);
      const resultadoOcr = await this.ocrService.processPdf(fakeMulterFile, serviceDocType);

      // 7. Persistência Final no Banco de Dados
      this.logger.log(`[JOB ${job.id}] ✅ Sucesso! Texto extraído: ${resultadoOcr.fullText?.length || 0} caracteres.`);
      
      await this.documentoService.atualizarDadosOcr(documentoId, {
        number: resultadoOcr.numero_doc,
        date: resultadoOcr.data_doc,
        title: `${tipo} ${resultadoOcr.numero_doc}`.trim(),
        description: resultadoOcr.trecho_capturado,
        fullText: resultadoOcr.fullText,
        status_ocr: StatusOcr.CONCLUIDO,
      });

      return resultadoOcr;

    } catch (error) {
      this.logger.error(`[JOB ${job.id}] ❌ Erro: ${error.message}`);
      
      // Notifica o erro no banco de dados para a UI do usuário
      await this.documentoService.atualizarDadosOcr(documentoId, { 
        status_ocr: StatusOcr.ERRO,
        mensagem_erro: error.message 
      });

      throw error; // Mantém o erro no BullMQ para controle de falhas
    }
  }
}