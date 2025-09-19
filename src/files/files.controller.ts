// src/files/files.controller.ts

import {
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
  BadRequestException,
  Body,
  Res,
  Get,
  Query,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { FilesService } from './files.service';
import { OcrService } from './ocr.service';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { IsNotEmpty, IsString } from 'class-validator';
import { Response } from 'express';

// DTO para validar o corpo da requisição da nova rota de finalização
class FinalizeUploadDto {
  @IsString()
  @IsNotEmpty()
  tempFilename: string;

  @IsString()
  @IsNotEmpty()
  finalFilename: string;
}

// Seu DTO de OCR original (sem alterações)
class OcrRequestDto {
  docType: 'PORTARIA' | 'LEI_ORDINARIA' | 'DECRETO' | 'LEI_COMPLEMENTAR';
}

@Controller('files')
export class FilesController {
  constructor(
    private readonly filesService: FilesService,
    private readonly ocrService: OcrService,
  ) {}

  // --- MUDANÇA 1: A rota 'upload-pdf' foi renomeada e simplificada ---
  /**
   * ETAPA 1: Salva o PDF temporariamente no disco do servidor.
   * Retorna um identificador (o próprio nome do arquivo) para ser usado na próxima etapa.
   */
  @Post('upload-temporary-pdf')
  @UseInterceptors(
    FileInterceptor('file', {
      // A configuração do multer permanece a mesma
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
  uploadTemporaryPdf(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('Nenhum arquivo enviado.');
    }

    // A chamada para 'processPdf' foi removida.
    // Agora, apenas retornamos o nome do arquivo temporário.
    return {
      message: 'Arquivo enviado temporariamente. Prossiga para a finalização.',
      tempFilename: file.filename,
    };
  }

  // --- MUDANÇA 2: Uma nova rota foi criada para a finalização ---
  /**
   * ETAPA 2: Recebe o nome do arquivo temporário e o nome final desejado,
   * e chama o serviço para mover o arquivo para o MinIO.
   */
  @Post('finalize-upload')
  async finalizeUpload(@Body() finalizeUploadDto: FinalizeUploadDto) {
    // Graças ao DTO e ao ValidationPipe, já sabemos que os dados estão presentes e são strings.
    // A chamada agora é para o novo método do nosso serviço.
    return this.filesService.moveTempFileToMinio(
      finalizeUploadDto.tempFilename,
      finalizeUploadDto.finalFilename,
    );
  }

  // --- SEM MUDANÇAS: Sua rota de OCR permanece exatamente como estava ---
  /**
   * Rota para processar OCR de um arquivo PDF.
   */
  @Post('ocr')
  @UseInterceptors(FileInterceptor('file'))
  async processOcr(
    @UploadedFile() file: Express.Multer.File,
    @Body() body: OcrRequestDto,
  ) {
    if (!file) {
      throw new BadRequestException('Nenhum arquivo para OCR recebido.');
    }

    // O tipo específico que seu serviço espera
    type ServiceDocType =
      | 'portaria'
      | 'decreto'
      | 'lei_ordinaria'
      | 'lei_complementar';

    // A variável que irá guardar o tipo mapeado e seguro
    let serviceDocType: ServiceDocType;

    // O switch já garante que apenas valores válidos serão atribuídos
    switch (body.docType) {
      case 'PORTARIA':
        serviceDocType = 'portaria';
        break;
      case 'DECRETO':
        serviceDocType = 'decreto';
        break;
      case 'LEI_ORDINARIA':
        serviceDocType = 'lei_ordinaria';
        break;
      case 'LEI_COMPLEMENTAR':
        serviceDocType = 'lei_complementar';
        break;
      default:
        // Se o docType for inválido, lance um erro claro
        throw new BadRequestException(
          `Tipo de documento inválido: ${String(body.docType)}`,
        );
    }

    // Agora a chamada é 100% segura, sem a necessidade de 'as any'
    return await this.ocrService.processPdf(file, serviceDocType);
  }

  @Get('download')
  async downloadFile(
    @Query('filename') filename: string,
    @Res() res: Response,
  ) {
    const fileBuffer = await this.filesService.downloadFileFromMinio(filename);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${filename.split('/').pop()}"`,
    );
    res.send(fileBuffer);
  }
  // curl -X GET "http://localhost:3001/files/download?filename=LEI_ORDINARIA/5553-2023-01-10.pdf" -o 5553-2023-01-10.pdf
}
