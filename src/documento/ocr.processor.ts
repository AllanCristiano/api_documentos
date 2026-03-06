import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { DocumentoService } from './documento.service';
import { StatusOcr } from './entities/documento.entity';
import { OcrService } from '../files/ocr.service'; // Ajuste o path conforme sua estrutura
import { FilesService } from '../files/files.service'; // Ajuste o path conforme sua estrutura

@Processor('ocr-queue', {
  concurrency: 1, // Um por vez para preservar CPU/RAM
  lockDuration: 300000, // 5 minutos
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
    
    this.logger.log(`[JOB ${job.id}] 🚀 Iniciando OCR do documento ID: ${documentoId}`);

    try {
      // 1. Marcar como processando no banco
      await this.documentoService.atualizarDadosOcr(documentoId, { 
        status_ocr: StatusOcr.PROCESSANDO 
      });

      // 2. Extrair a Key correta para o MinIO
      // Se a URL for http://localhost:9000/pma/PORTARIA/arquivo.pdf, 
      // precisamos apenas de "PORTARIA/arquivo.pdf"
      // Aqui usamos uma lógica mais genérica para pegar tudo após o nome do bucket (pma)
      const bucketName = 'pma'; // Nome do seu bucket
      const objectKey = arquivoUrl.includes(`${bucketName}/`) 
        ? arquivoUrl.split(`${bucketName}/`)[1] 
        : arquivoUrl;

      this.logger.debug(`[JOB ${job.id}] Baixando arquivo do MinIO com a key: ${objectKey}`);

      // 3. Download do arquivo
      const fileBuffer = await this.filesService.downloadFileFromMinio(objectKey);

      if (!fileBuffer || fileBuffer.length === 0) {
        throw new Error('O buffer do arquivo baixado está vazio.');
      }

      // 4. Preparar objeto para o OcrService (Mock de Multer File)
      const fakeMulterFile = {
        buffer: fileBuffer,
        originalname: objectKey.split('/').pop(),
        mimetype: 'application/pdf',
      } as Express.Multer.File;

      // 5. Normalizar tipo para o mapeamento do OcrService
      const serviceDocType = tipo.toLowerCase();

      // 6. Executar o OCR pesado (pdftoppm + Tesseract)
      this.logger.log(`[JOB ${job.id}] ⏳ Executando Tesseract nas imagens do PDF...`);
      const resultadoOcr = await this.ocrService.processPdf(fakeMulterFile, serviceDocType as any);

      // 7. Persistir tudo no Banco de Dados
      this.logger.log(`[JOB ${job.id}] ✅ OCR concluído. Salvando ${resultadoOcr.fullText.length} caracteres de texto.`);
      
      await this.documentoService.atualizarDadosOcr(documentoId, {
        number: resultadoOcr.numero_doc,
        date: resultadoOcr.data_doc,
        title: `${tipo} ${resultadoOcr.numero_doc || ''}`.trim(), 
        description: resultadoOcr.trecho_capturado,
        fullText: resultadoOcr.fullText, // <--- Aqui o texto completo entra no banco
        status_ocr: StatusOcr.CONCLUIDO,
      });

      return resultadoOcr;

    } catch (error) {
      this.logger.error(`[JOB ${job.id}] ❌ Falha no processamento: ${error.message}`);
      
      // Atualiza o banco com o erro para dar feedback ao usuário
      await this.documentoService.atualizarDadosOcr(documentoId, { 
        status_ocr: StatusOcr.ERRO,
        mensagem_erro: error.message 
      });

      throw error; // Lança para o BullMQ registrar a falha no Redis
    }
  }
}