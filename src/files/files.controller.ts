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

// DTO para o corpo da requisição de OCR
class OcrRequestDto {
  docType: 'PORTARIA' | 'LEI_ORDINARIA' | 'DECRETO' | 'LEI_COMPLEMENTAR';
}

@Controller('files')
export class FilesController {
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
  async processOcr(
    @UploadedFile() file: Express.Multer.File,
    @Body() body: OcrRequestDto,
  ) {
    // Define os tipos exatos que o serviço espera receber
    type ServiceDocType =
      | 'portaria'
      | 'decreto'
      | 'lei_ordinaria'
      | 'lei_complementar';
    let serviceDocType: ServiceDocType;

    // Mapeia o tipo recebido na requisição para o tipo esperado pelo serviço
    switch (body.docType) {
      case 'PORTARIA':
        serviceDocType = 'portaria';
        break;
      case 'DECRETO':
        serviceDocType = 'decreto';
        break;
      case 'LEI_ORDINARIA':
        serviceDocType = 'lei_ordinaria'; // Trata como um tipo específico
        break;
      case 'LEI_COMPLEMENTAR':
        serviceDocType = 'lei_complementar'; // Trata como outro tipo específico
        break;
      default:
        // Garante que um tipo de documento inesperado cause um erro claro
        throw new BadRequestException('Tipo de documento inválido.');
    }

    // Chama o serviço com o tipo de documento já mapeado e correto
    return await this.ocrService.processPdf(file, serviceDocType);
  }
}
