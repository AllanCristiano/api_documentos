import { Module } from '@nestjs/common';
import { FilesService } from './files.service';
import { FilesController } from './files.controller';
import { OcrService } from './ocr.service';
import { MinioService } from './minio.service';
import { BullModule } from '@nestjs/bullmq'; // 👈 Importe o BullModule
import { OcrProcessor } from 'src/documento/ocr.processor';
import { DocumentoModule } from '../documento/documento.module'; // 👈 Precisa para o DocumentoService

@Module({
  imports: [
    // 2. REGISTRO ESPECÍFICO (Cria a fila 'ocr-queue')
    BullModule.registerQueue({
      name: 'ocr-queue',
    }),
    // Importamos o DocumentoModule para que o Processor possa 
    // usar o DocumentoService e salvar no banco
    DocumentoModule, 
  ],
  controllers: [FilesController],
  providers: [
    FilesService, 
    OcrService, 
    MinioService, 
    OcrProcessor 
  ],
  exports: [FilesService, OcrService],
})
export class FilesModule {}