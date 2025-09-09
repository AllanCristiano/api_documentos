import { Module } from '@nestjs/common';
import { FilesService } from './files.service';
import { FilesController } from './files.controller';
import { OcrService } from './ocr.service';

@Module({
  controllers: [FilesController],
  providers: [FilesService, OcrService],
})
export class FilesModule {}
