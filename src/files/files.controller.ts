import {
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
  BadRequestException,
  Body,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { FilesService } from './files.service';
import { OcrService } from './ocr.service';
import { diskStorage } from 'multer';
import { extname } from 'path';

// 👈 1. Defina a classe DTO aqui
class OcrRequestDto {
  docType: 'portaria' | 'lei' | 'decreto';
}

@Controller('files')
export class FilesController {
  // 👈 2. Injete o OcrService no construtor
  constructor(
    private readonly filesService: FilesService,
    private readonly ocrService: OcrService,
  ) {}

  @Post('upload-pdf')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: './uploads',
        filename: (req, file, callback) => {
          const uniqueSuffix =
            Date.now() + '-' + Math.round(Math.random() * 1e9);
          const ext = extname(file.originalname);
          const filename = `${uniqueSuffix}${ext}`;
          callback(null, filename);
        },
      }),
      fileFilter: (req, file, callback) => {
        if (file.mimetype === 'application/pdf') {
          callback(null, true);
        } else {
          callback(
            new BadRequestException('Apenas arquivos PDF são permitidos!'),
            false,
          );
        }
      },
    }),
  )
  uploadPdf(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('Nenhum arquivo enviado.');
    }
    console.log(file);
    return this.filesService.processPdf(file);
  }

  /**
   * Rota para processar OCR de um arquivo PDF.
   * Espera um corpo 'form-data' com um campo 'file' (PDF) e um campo 'docType'.
   */
  @Post('ocr')
  @UseInterceptors(FileInterceptor('file'))
  // 👈 3. Adicione async e await
  async processOcr(
    @UploadedFile() file: Express.Multer.File,
    @Body() body: OcrRequestDto, // 👈 Use o decorator @Body()
  ) {
    return await this.ocrService.processPdf(file, body.docType);
  }
}
