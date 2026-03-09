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
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

// DTO atualizado para incluir o ID do banco e o tipo do documento
class FinalizeUploadDto {
  @IsString()
  @IsNotEmpty()
  tempFilename: string;

  @IsString()
  @IsNotEmpty()
  finalFilename: string;

  @IsString()
  @IsNotEmpty()
  documentoId: string; // O ID do registro criado no banco de dados

  @IsString()
  @IsNotEmpty()
  docType: 'PORTARIA' | 'LEI_ORDINARIA' | 'DECRETO' | 'LEI_COMPLEMENTAR';
}

class OcrRequestDto {
  @IsString()
  @IsNotEmpty()
  docType: 'PORTARIA' | 'LEI_ORDINARIA' | 'DECRETO' | 'LEI_COMPLEMENTAR';
}

@Controller('files')
export class FilesController {
  constructor(
    private readonly filesService: FilesService,
    private readonly ocrService: OcrService,
    @InjectQueue('ocr-queue') private readonly ocrQueue: Queue, // Injeção da fila
  ) {}

  /**
   * ETAPA 1: Upload para pasta temporária
   */
  @Post('upload-temporary-pdf')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: './uploads',
        filename: (req, file, callback) => {
          const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
          const ext = extname(file.originalname);
          callback(null, `${uniqueSuffix}${ext}`);
        },
      }),
      fileFilter: (req, file, callback) => {
        if (file.mimetype === 'application/pdf') {
          callback(null, true);
        } else {
          callback(new BadRequestException('Apenas arquivos PDF são permitidos!'), false);
        }
      },
    }),
  )
  uploadTemporaryPdf(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('Nenhum arquivo enviado.');
    return {
      message: 'Arquivo enviado temporariamente.',
      tempFilename: file.filename,
    };
  }

  /**
   * ETAPA 2: Move para MinIO e DISPARA OCR
   */
  @Post('finalize-upload')
  async finalizeUpload(@Body() finalizeUploadDto: FinalizeUploadDto) {
    // 1. Move o arquivo do disco local para o MinIO
    const uploadResult = await this.filesService.moveTempFileToMinio(
      finalizeUploadDto.tempFilename,
      finalizeUploadDto.finalFilename,
    );

    // 2. Adiciona o trabalho de OCR na fila do BullMQ
    // O Worker (OcrProcessor) vai pegar esses dados para trabalhar em segundo plano
    await this.ocrQueue.add('processar-ocr', {
      documentoId: finalizeUploadDto.documentoId,
      tipo: finalizeUploadDto.docType,
      arquivoUrl: uploadResult.url, // URL retornada pelo MinioService
    }, {
      attempts: 3, // Tenta 3 vezes em caso de falha
      backoff: 5000, // Espera 5 segundos entre tentativas
    });

    return {
      ...uploadResult,
      message: 'Upload finalizado e OCR agendado com sucesso!',
    };
  }

  /**
   * Rota manual de OCR (para reprocessamento se necessário)
   */
  @Post('ocr-manual')
  @UseInterceptors(FileInterceptor('file'))
  async processOcr(
    @UploadedFile() file: Express.Multer.File,
    @Body() body: OcrRequestDto,
  ) {
    if (!file) throw new BadRequestException('Nenhum arquivo para OCR recebido.');

    const typeMap = {
      'PORTARIA': 'portaria',
      'DECRETO': 'decreto',
      'LEI_ORDINARIA': 'lei_ordinaria',
      'LEI_COMPLEMENTAR': 'lei_complementar',
    };

    const serviceDocType = typeMap[body.docType];
    if (!serviceDocType) throw new BadRequestException('Tipo de documento inválido.');

    return await this.ocrService.processPdf(file, serviceDocType as any);
  }

  /**
   * 🔧 LÓGICA DE DOWNLOAD MELHORADA
   * Aceita a URL completa do banco ou apenas a chave do MinIO e extrai o arquivo.
   */
  @Get('download')
  async downloadFile(@Query('filename') filename: string, @Res() res: Response) {
    if (!filename) {
      throw new BadRequestException('O parâmetro filename é obrigatório.');
    }

    // Inteligência para extrair a chave correta, caso o frontend envie a URL completa
    let objectKey = filename;
    
    // Se vier a URL inteira (ex: http://.../atos-normativos/LEI_ORDINARIA/arquivo.pdf)
    // O regex pega tudo que vem DEPOIS de "atos-normativos/"
    const bucketMatch = filename.match(/atos-normativos\/(.*)/);
    if (bucketMatch && bucketMatch[1]) {
      objectKey = bucketMatch[1];
    }

    // Busca o buffer do arquivo no MinIO usando a chave limpa
    const fileBuffer = await this.filesService.downloadFileFromMinio(objectKey);
    
    // Pega apenas o nome final do arquivo para exibir no navegador (ex: LEI_ORDINARIA_6295_2025-12-31.pdf)
    const downloadName = objectKey.split('/').pop() || 'documento.pdf';

    res.setHeader('Content-Type', 'application/pdf');
    // Adiciona aspas ao redor do nome para evitar bugs com espaços
    res.setHeader('Content-Disposition', `attachment; filename="${downloadName}"`);
    res.send(fileBuffer);
  }
}