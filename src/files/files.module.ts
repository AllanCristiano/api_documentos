import { Module, forwardRef } from '@nestjs/common';
import { FilesService } from './files.service';
import { FilesController } from './files.controller';
import { OcrService } from './ocr.service';
import { MinioService } from './minio.service';
import { BullModule } from '@nestjs/bullmq';
import { OcrProcessor } from '../documento/ocr.processor';
import { DocumentoModule } from '../documento/documento.module';

@Module({
  imports: [
    // 1. Registro da fila para este módulo
    BullModule.registerQueue({
      name: 'ocr-queue',
    }),

    forwardRef(() => DocumentoModule),
  ],
  controllers: [FilesController],
  providers: [
    FilesService,
    OcrService,
    MinioService,
    OcrProcessor, 
  ],
  
  exports: [FilesService, OcrService, BullModule],
})
export class FilesModule {}