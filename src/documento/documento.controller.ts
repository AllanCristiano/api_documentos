import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Res,
  StreamableFile,
  NotFoundException,
} from '@nestjs/common';
import { Response } from 'express';
import { DocumentoService } from './documento.service';
import { CreateDocumentoDto } from './dto/create-documento.dto';

@Controller('documento')
export class DocumentoController {
  constructor(private readonly documentoService: DocumentoService) {}

  @Post()
  create(@Body() createDocumentoDto: CreateDocumentoDto) {
    return this.documentoService.create(createDocumentoDto);
  }

  @Get()
  findAll() {
    return this.documentoService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.documentoService.findOne(+id);
  }

  @Get('download/:filename')
  downloadPdf(
    @Param('filename') filename: string,
    @Res({ passthrough: true }) res: Response,
  ): StreamableFile {
    // Obtém o stream e infos do arquivo
    type PdfStreamResult = {
      stream: import('stream').Readable;
      stat: { size: number };
    };
    let fileData: PdfStreamResult;
    try {
      fileData = this.documentoService.getPdfStream(
        filename,
      ) as PdfStreamResult;
    } catch {
      throw new NotFoundException('Arquivo não encontrado');
    }

    const { stream, stat } = fileData;

    // Cabeçalhos para forçar o download
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': stat.size,
    });

    return new StreamableFile(stream);
  }
}
