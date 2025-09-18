import { Module } from '@nestjs/common';
import { FilesService } from './files.service';
import { FilesController } from './files.controller';
import { OcrService } from './ocr.service';
import { MinioService } from './minio.service';

@Module({
  controllers: [FilesController],
  providers: [FilesService, OcrService, MinioService],
  exports: [FilesService],
})
export class FilesModule {}
