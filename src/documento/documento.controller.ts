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
  Delete,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Response } from 'express';
import { DocumentoService } from './documento.service';
import { AprovarDocumentoDto, CreateDocumentoDto } from './dto/create-documento.dto';

@Controller('documento')
export class DocumentoController {
  constructor(private readonly documentoService: DocumentoService) {}

  // =========================================================================
  // 1. ROTAS DO NOVO FLUXO ASSÍNCRONO
  // =========================================================================

  /**
   * Passo 1: Recebe o tipo e o arquivo temporário, cria como PENDENTE e joga na fila.
   * Retorna 202 (Accepted) porque o processamento real (OCR) será feito em background.
   */
  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  createPendente(
    @Body('type') type: string,
    @Body('tempFilename') tempFilename: string,
  ) {
    if (!type || !tempFilename) {
      throw new BadRequestException(
        'Os campos "type" e "tempFilename" são obrigatórios para iniciar o processamento.',
      );
    }
    return this.documentoService.createPendente(type, tempFilename);
  }

  /**
   * Passo 3: Rota para o usuário aprovar o documento após revisar os dados do OCR.
   */
  @Patch(':id/aprovar')
  aprovarDocumento(
    @Param('id', ParseIntPipe) id: number,
    @Body() dadosAprovados: AprovarDocumentoDto,
  ) {
    return this.documentoService.aprovarDocumento(id, dadosAprovados);
  }

  // =========================================================================
  // 2. ROTAS ORIGINAIS (Busca, Edição, Deleção e Download)
  // =========================================================================

  @Get()
  findAll() {
    return this.documentoService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.documentoService.findOne(+id);
  }

  @Get('numero/:number')
  findByNumber(@Param('number') number: string) {
    return this.documentoService.findByNumber(number);
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

  /**
   * Atualizado para receber também o originalName do frontend
   */
  @Patch(':id/file')
  async updateFile(
    @Param('id', ParseIntPipe) id: number,
    @Body('tempFilename') tempFilename: string,
    @Body('originalName') originalName?: string,
  ) {
    if (!tempFilename) {
      throw new BadRequestException(
        'O nome do arquivo temporário (tempFilename) é obrigatório.',
      );
    }
    return this.documentoService.updateFile(id, tempFilename, originalName);
  }

  @Put(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateDocumentoDto: Partial<AprovarDocumentoDto>,
  ) {
    return this.documentoService.update(id, updateDocumentoDto as any);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.documentoService.remove(id);
  }

  // =========================================================================
  // 3. ROTAS DE MANUTENÇÃO (FIX)
  // =========================================================================

  @Get('fix/reprocessar-tudo')
  reprocessarTodosLegados() {
    return this.documentoService.reprocessarLegadosFila();
  }

  /**
   * Rota Definitiva: Padroniza os nomes dos arquivos no MinIO e no banco de dados.
   */
  @Get('fix/padronizar-todos')
  async padronizarTodos() {
    return await this.documentoService.padronizarTodosAprovados();
  }

  /**
   * Rota Definitiva: Varre o banco e atualiza as descrições (ementas) pelo novo padrão
   */
  @Get('fix/atualizar-ementas')
  async consertarEmentas() {
    return await this.documentoService.atualizarTodasAsEmentas();
  }
}