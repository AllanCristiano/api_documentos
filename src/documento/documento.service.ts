import {
  Injectable,
  NotFoundException,
  ConflictException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Not, IsNull } from 'typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { join, parse } from 'path';
import { createReadStream, statSync, createWriteStream } from 'fs';
import { randomUUID } from 'crypto';

import { Documento, StatusOcr } from './entities/documento.entity';
import { Atualizacao } from './entities/update.entity';
import { FilesService } from 'src/files/files.service';
import { CreateDocumentoDto } from './dto/create-documento.dto';

@Injectable()
export class DocumentoService {
  private readonly logger = new Logger(DocumentoService.name);
  private readonly pdfDirectory = join(process.cwd(), 'pdfs');

  constructor(
    @InjectRepository(Documento)
    private readonly documentoRepository: Repository<Documento>,

    @InjectRepository(Atualizacao)
    private readonly atualizacaoRepository: Repository<Atualizacao>,

    private readonly filesService: FilesService,

    @InjectQueue('ocr-queue') private ocrQueue: Queue,
  ) {}

  // =========================================================================
  // 1. FLUXO ASSÍNCRONO (MÉTODOS EXIGIDOS PELO OCR.PROCESSOR)
  // =========================================================================

  /**
   * 🔧 MÉTODO CRÍTICO: Usado pelo OcrProcessor para salvar os resultados do OCR.
   * Implementa trava de segurança para não sobrescrever dados já preenchidos.
   */
  async atualizarDadosOcr(id: number, dadosOcr: Partial<Documento>): Promise<void> {
    const documento = await this.findOne(id);

    // Preserva dados se já existirem, exceto se for explicitamente enviado novo texto/status
    if (dadosOcr.number && !documento.number) documento.number = dadosOcr.number;
    if (dadosOcr.title && !documento.title) documento.title = dadosOcr.title;
    if (dadosOcr.date && !documento.date) documento.date = dadosOcr.date;
    
    if (dadosOcr.description !== undefined) documento.description = dadosOcr.description;
    if (dadosOcr.fullText !== undefined) documento.fullText = dadosOcr.fullText;
    if (dadosOcr.status_ocr !== undefined) documento.status_ocr = dadosOcr.status_ocr;
    if (dadosOcr.mensagem_erro !== undefined) documento.mensagem_erro = dadosOcr.mensagem_erro;

    await this.documentoRepository.save(documento);
  }

  async createPendente(type: string, tempFilename: string): Promise<Documento> {
    const finalFilename = `${type}/pendente-${Date.now()}-${tempFilename}`;
    const uploadResult = await this.filesService.moveTempFileToMinio(tempFilename, finalFilename);

    const novoDocumento = this.documentoRepository.create({
      type: type,
      url: uploadResult.url,
      status_ocr: StatusOcr.PENDENTE,
      aprovado: false,
    });

    const documentoSalvo = await this.documentoRepository.save(novoDocumento);
    await this.ocrQueue.add('processar-pdf', {
      documentoId: documentoSalvo.id,
      tipo: type,
      arquivoUrl: uploadResult.url,
    });

    return documentoSalvo;
  }

  // =========================================================================
  // 2. MÉTODOS DE BUSCA E DOWNLOAD
  // =========================================================================

  async findAll(): Promise<Documento[]> {
    return await this.documentoRepository.find({ order: { date: 'DESC' } });
  }

  async findOne(id: number): Promise<Documento> {
    const documento = await this.documentoRepository.findOneBy({ id });
    if (!documento) throw new NotFoundException(`Documento ID ${id} não encontrado`);
    return documento;
  }

  async findByNumber(number: string): Promise<Documento> {
    const documento = await this.documentoRepository.findOneBy({ number });
    if (!documento) throw new NotFoundException(`Documento número ${number} não encontrado`);
    return documento;
  }

  getPdfStream(filename: string) {
    const filePath = join(this.pdfDirectory, filename);
    try {
      const stat = statSync(filePath);
      const stream = createReadStream(filePath);
      return { stream, stat };
    } catch {
      throw new NotFoundException('Arquivo não encontrado no disco local');
    }
  }

  // =========================================================================
  // 3. MÉTODOS DE MANUTENÇÃO E APROVAÇÃO
  // =========================================================================

  async aprovarDocumento(id: number, dadosAprovados: Partial<Documento>): Promise<Documento> {
    const documento = await this.findOne(id);
    let urlDefinitiva = documento.url;

    if (documento.url && documento.url.includes('pendente-')) {
      try {
        const bucketMatch = documento.url.match(/atos-normativos\/(.*)/);
        if (bucketMatch && bucketMatch[1]) {
          const oldKey = bucketMatch[1];
          const numLimpo = (dadosAprovados.number || documento.number || 'S-N').replace(/[./]/g, '-');
          const dataDoc = dadosAprovados.date || documento.date || new Date().toISOString().split('T')[0];
          const newKey = `${documento.type}/${documento.type}_${numLimpo}_${dataDoc}.pdf`;
          urlDefinitiva = await this.filesService.renameFileInMinio(oldKey, newKey);
        }
      } catch (err) {
        this.logger.error(`Erro ao renomear arquivo: ${err.message}`);
      }
    }

    Object.assign(documento, { ...dadosAprovados, url: urlDefinitiva, aprovado: true });
    const docSalvo = await this.documentoRepository.save(documento);
    await this._atualizarTimestamp(docSalvo.type);
    return docSalvo;
  }

  async update(id: number, updateDto: Partial<Documento>): Promise<Documento> {
    const documento = await this.documentoRepository.preload({ id, ...updateDto });
    if (!documento) throw new NotFoundException(`ID ${id} não encontrado`);
    const salvo = await this.documentoRepository.save(documento);
    await this._atualizarTimestamp(salvo.type);
    return salvo;
  }

  async updateFile(id: number, tempFilename: string, originalName?: string): Promise<Documento> {
    const documento = await this.findOne(id);
    const baseName = originalName ? parse(originalName).name.replace(/[^\w\d-]/g, '') : `doc-${id}`;
    const finalFilename = `${documento.type}/${baseName}-${randomUUID()}.pdf`;
    
    const uploadResult = await this.filesService.moveTempFileToMinio(tempFilename, finalFilename);
    documento.url = uploadResult.url;
    return await this.documentoRepository.save(documento);
  }

  async atualizaData(number: string, novaData: string): Promise<Documento> {
    const documento = await this.findByNumber(number);
    documento.date = novaData;
    return this.documentoRepository.save(documento);
  }

  async remove(id: number): Promise<void> {
    const doc = await this.findOne(id);
    await this.documentoRepository.remove(doc);
    await this._atualizarTimestamp(doc.type);
  }

  // =========================================================================
  // 4. ROTAS DE FIX (MIGRAÇÃO DOS 3000+)
  // =========================================================================

  async migracaoMassaComSanitizacaoELog() {
    const logPath = join(process.cwd(), 'migracao_falhas.log');
    const logStream = createWriteStream(logPath, { flags: 'a' });
    const docsFaltantes = await this.documentoRepository.find({
      where: [{ fullText: IsNull() }, { fullText: "" }]
    });

    logStream.write(`\n--- INÍCIO MIGRAÇÃO: ${new Date().toLocaleString()} ---\n`);
    let processados = 0;
    for (const doc of docsFaltantes) {
      try {
        await this.ocrQueue.add('processar-pdf', {
          documentoId: doc.id,
          tipo: doc.type,
          arquivoUrl: doc.url,
        });
        await this.documentoRepository.update(doc.id, { status_ocr: StatusOcr.PROCESSANDO });
        processados++;
      } catch (err) {
        logStream.write(`[ERRO] ID: ${doc.id} | ${err.message}\n`);
      }
    }
    logStream.end();
    return { enfileirados: processados, totalFaltantes: docsFaltantes.length };
  }

  async reprocessarLegadosFila() {
    const docs = await this.documentoRepository.find({
      where: { fullText: IsNull(), url: Not(IsNull()) }
    });
    for (const doc of docs) {
      await this.ocrQueue.add('processar-pdf', {
        documentoId: doc.id,
        tipo: doc.type,
        arquivoUrl: doc.url,
      });
    }
    return { quantidade: docs.length };
  }

  async padronizarTodosAprovados() {
    const documentos = await this.documentoRepository.find({ where: { aprovado: true } });
    let sucesso = 0;
    for (const doc of documentos) {
      try {
        const bucketMatch = doc.url.match(/atos-normativos\/(.*)/);
        if (bucketMatch && bucketMatch[1]) {
          const oldKey = bucketMatch[1];
          const numLimpo = doc.number ? doc.number.replace(/[./]/g, '-') : `sem-num-${doc.id}`;
          const newKey = `${doc.type}/${doc.type}_${numLimpo}_${doc.date}.pdf`;
          if (oldKey !== newKey) {
            doc.url = await this.filesService.renameFileInMinio(oldKey, newKey);
            await this.documentoRepository.save(doc);
            sucesso++;
          }
        }
      } catch {}
    }
    return { padronizados: sucesso };
  }

  async atualizarTodasAsEmentas() {
    const documentos = await this.documentoRepository.find({ where: { fullText: Not(IsNull()) } });
    let sucesso = 0;
    for (const doc of documentos) {
      const cleanText = doc.fullText.replace(/\s+/g, ' ');
      const ementaPattern = /(?:DE\s+\d{4}|202\d)[\s.,;]*([\s\S]*?)(?:A\s+PREFEITA|O\s+PREFEITO|Faço\s+saber|Art\.\s*1º)/i;
      const ementaMatch = ementaPattern.exec(cleanText);
      if (ementaMatch) {
        const ementaLimpa = ementaMatch[1].trim()
          .replace(/[=|_|Ú|À|\\|\[|\]|«|»|©]+/g, ' ')
          .substring(0, 350);
        doc.description = ementaLimpa;
        await this.documentoRepository.save(doc);
        sucesso++;
      }
    }
    return { atualizados: sucesso };
  }

  private async _atualizarTimestamp(tipo: string) {
    try {
      let registro = await this.atualizacaoRepository.findOneBy({ id: 1 }) || this.atualizacaoRepository.create({ id: 1 });
      const agora = new Date();
      registro.date_total = agora;
      const t = tipo.toLowerCase();
      if (t === 'portaria') registro.date_portaria = agora;
      else if (t.includes('ordinaria')) registro.date_lei_ordinaria = agora;
      else if (t.includes('complementar')) registro.date_lei_complementar = agora;
      else if (t === 'decreto') registro.date_decreto = agora;
      await this.atualizacaoRepository.save(registro);
    } catch {}
  }
}