import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Res,
  StreamableFile,
  NotFoundException,
  ParseIntPipe,
  Put,
  BadRequestException,
  Delete, // <--- 1. Importado o Delete
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

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': stat.size,
    });

    return new StreamableFile(stream);
  }

  @Patch('data/:numero')
  async atualizaData(
    @Param('numero') numero: string,
    @Body('novaData') novaData: string,
  ) {
    return this.documentoService.atualizaData(numero, novaData);
  }

  @Patch(':id/file')
  async updateFile(
    @Param('id', ParseIntPipe) id: number,
    @Body('tempFilename') tempFilename: string,
  ) {
    if (!tempFilename) {
      throw new BadRequestException(
        'O nome do arquivo temporário (tempFilename) é obrigatório.',
      );
    }
    return this.documentoService.updateFile(id, tempFilename);
  }

  @Put(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateDocumentoDto: Partial<CreateDocumentoDto>,
  ) {
    return this.documentoService.update(id, updateDocumentoDto);
  }

  // --- 2. NOVO MÉTODO DE DELETE ---
  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.documentoService.remove(id);
  }
}