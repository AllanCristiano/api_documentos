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

  @Patch('data/:numero')
  async atualizaData(
    @Param('numero') numero: string,
    @Body('novaData') novaData: string,
  ) {
    return this.documentoService.atualizaData(numero, novaData);
  }

  @Put(':id')
  update(
    @Param('id', ParseIntPipe) id: number, // Usa o ID e converte para número
    @Body() updateDocumentoDto: Partial<CreateDocumentoDto>,
  ) {
    // Chama o service, passando o ID
    return this.documentoService.update(id, updateDocumentoDto);
  }
}
