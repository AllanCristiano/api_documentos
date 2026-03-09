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
  // 1. FLUXO ASSÍNCRONO (PENDENTES E FILA)
  // =========================================================================

  /**
   * Passo 1: Recebe o arquivo temporário, cria como PENDENTE e envia para a fila OCR.
   */
  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  createPendente(
    @Body('type') type: string,
    @Body('tempFilename') tempFilename: string,
  ) {
    if (!type || !tempFilename) {
      throw new BadRequestException(
        'Os campos "type" e "tempFilename" são obrigatórios.',
      );
    }
    return this.documentoService.createPendente(type, tempFilename);
  }

  /**
   * Passo 3: Aprovação manual dos dados extraídos pelo OCR.
   */
  @Patch(':id/aprovar')
  aprovarDocumento(
    @Param('id', ParseIntPipe) id: number,
    @Body() dadosAprovados: AprovarDocumentoDto,
  ) {
    return this.documentoService.aprovarDocumento(id, dadosAprovados);
  }

  // =========================================================================
  // 2. BUSCA, EDIÇÃO E DOWNLOAD
  // =========================================================================

  @Get()
  findAll() {
    return this.documentoService.findAll();
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.documentoService.findOne(id);
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
    const fileData = this.documentoService.getPdfStream(filename);

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': fileData.stat.size,
    });

    return new StreamableFile(fileData.stream);
  }

  @Patch(':id/file')
  async updateFile(
    @Param('id', ParseIntPipe) id: number,
    @Body('tempFilename') tempFilename: string,
    @Body('originalName') originalName?: string,
  ) {
    if (!tempFilename) {
      throw new BadRequestException('O tempFilename é obrigatório.');
    }
    return this.documentoService.updateFile(id, tempFilename, originalName);
  }

  @Put(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateDocumentoDto: Partial<AprovarDocumentoDto>,
  ) {
    return this.documentoService.update(id, updateDocumentoDto);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.documentoService.remove(id);
  }

  // =========================================================================
  // 3. ROTAS DE MANUTENÇÃO E FIX (OPERAÇÃO DE PRODUÇÃO)
  // =========================================================================

  /**
   * 🔥 ROTA DE EMERGÊNCIA: Processa os 3.000+ documentos sem texto.
   * - Identifica registros sem fullText.
   * - Envia para a fila para fazer OCR e Sanitização (remove ==, ||, etc).
   * - Gera o log 'migracao_falhas.log' na raiz da API.
   */
  @Get('fix/migracao-geral')
  async migracaoGeral() {
    return await this.documentoService.migracaoMassaComSanitizacaoELog();
  }

  /**
   * Padroniza os nomes dos arquivos no MinIO e URLs no banco de dados.
   */
  @Get('fix/padronizar-todos')
  async padronizarTodos() {
    return await this.documentoService.padronizarTodosAprovados();
  }

  /**
   * Varre quem já tem OCR e aplica a nova limpeza de ementas.
   */
  @Get('fix/atualizar-ementas')
  async consertarEmentas() {
    return await this.documentoService.atualizarTodasAsEmentas();
  }

  /**
   * Fallback para reprocessar legados via fila BullMQ.
   */
  @Get('fix/reprocessar-tudo')
  reprocessarTodosLegados() {
    return this.documentoService.reprocessarLegadosFila();
  }
}