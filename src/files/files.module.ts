import { Module, forwardRef } from '@nestjs/common';
import { FilesService } from './files.service';
import { FilesController } from './files.controller';
import { OcrService } from './ocr.service';
import { MinioService } from './minio.service';
import { BullModule } from '@nestjs/bullmq';
import { OcrProcessor } from '../documento/ocr.processor'; // Verifique se o caminho está correto
import { DocumentoModule } from '../documento/documento.module';

@Module({
  imports: [
    // 1. Registro da fila para este módulo
    BullModule.registerQueue({
      name: 'ocr-queue',
    }),

    // 2. CORREÇÃO: Usando forwardRef para evitar dependência circular com DocumentoModule
    // Isso resolve o erro de "index [1] of the FilesModule imports array is undefined"
    forwardRef(() => DocumentoModule),
  ],
  controllers: [FilesController],
  providers: [
    FilesService,
    OcrService,
    MinioService,
    OcrProcessor, // O Worker/Processor precisa ser um provider
  ],
  // Exportamos os serviços para que o DocumentoModule possa usá-los se necessário
  exports: [FilesService, OcrService, BullModule],
})
export class FilesModule {}