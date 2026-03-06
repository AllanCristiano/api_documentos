import {
  Injectable,
  NotFoundException,
  ConflictException,
  InternalServerErrorException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Not, IsNull } from 'typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { join, parse } from 'path'; // <-- parse adicionado
import { createReadStream, statSync } from 'fs';
import { randomUUID } from 'crypto'; // <-- randomUUID adicionado

import { Documento, StatusOcr } from './entities/documento.entity';
import { Atualizacao } from './entities/update.entity';
import { FilesService } from 'src/files/files.service';
import { CreateDocumentoDto } from './dto/create-documento.dto';

@Injectable()
export class DocumentoService {
  private readonly pdfDirectory = join(process.cwd(), 'pdfs');

  constructor(
    @InjectRepository(Documento)
    private readonly documentoRepository: Repository<Documento>,

    @InjectRepository(Atualizacao)
    private readonly atualizacaoRepository: Repository<Atualizacao>,

    private readonly filesService: FilesService,

    // Injeção da fila do BullMQ
    @InjectQueue('ocr-queue') private ocrQueue: Queue,
  ) {}

  // =========================================================================
  // 1. NOVO FLUXO ASSÍNCRONO (FILA E APROVAÇÃO)
  // =========================================================================

  /**
   * Passo 1: Recebe o arquivo em lote, salva no banco como PENDENTE e envia pra fila.
   */
  async createPendente(type: string, tempFilename: string): Promise<Documento> {
    const finalFilename = `${type}/pendente-${Date.now()}-${tempFilename}`;

    let uploadResult;
    try {
      uploadResult = await this.filesService.moveTempFileToMinio(
        tempFilename,
        finalFilename,
      );
    } catch (error) {
      throw new InternalServerErrorException(
        `Erro ao salvar o arquivo: ${error.message}`,
      );
    }

    const novoDocumento = this.documentoRepository.create({
      type: type,
      url: uploadResult.url,
      status_ocr: StatusOcr.PENDENTE,
      aprovado: false,
    });

    const documentoSalvo = await this.documentoRepository.save(novoDocumento);

    // Envia o trabalho para a fila (O worker vai pegar isso aqui)
    await this.ocrQueue.add('processar-pdf', {
      documentoId: documentoSalvo.id,
      tipo: type,
      arquivoUrl: uploadResult.url, 
    });

    return documentoSalvo;
  }

  /**
   * Passo 2: O Worker (Processador) chama este método quando termina de ler o PDF.
   */
  async atualizarDadosOcr(id: number, dadosOcr: Partial<Documento>): Promise<void> {
    const documento = await this.findOne(id);

    Object.assign(documento, {
      ...dadosOcr,
      status_ocr: StatusOcr.CONCLUIDO,
    });

    await this.documentoRepository.save(documento);
  }

  /**
   * Passo 3: O usuário revisa os dados na interface e aprova a publicação.
   */
  async aprovarDocumento(id: number, dadosAprovados: Partial<Documento>): Promise<Documento> {
    const documento = await this.findOne(id);

    // Se o usuário editou o número durante a aprovação, checamos conflitos
    if (dadosAprovados.number && dadosAprovados.number !== documento.number) {
      const conflito = await this.documentoRepository.findOneBy({ number: dadosAprovados.number });
      if (conflito) {
        throw new ConflictException(`Documento com número ${dadosAprovados.number} já existe.`);
      }
    }

    Object.assign(documento, {
      ...dadosAprovados,
      aprovado: true,
    });

    const docSalvo = await this.documentoRepository.save(documento);
    
    // Atualiza a dashboard apenas quando o documento é oficialmente aprovado
    await this._atualizarTimestamp(docSalvo.type);

    return docSalvo;
  }

  /**
   * Rota temporária para consertar os documentos antigos do banco.
   */
  async aprovarDocumentosLegados() {
    // Agora ele vai pegar todos os documentos que estão pendentes ou que não foram aprovados
    const result = await this.documentoRepository.update(
      { aprovado: false }, // Se o documento antigo estava como false (ou o default bateu false)
      { aprovado: true, status_ocr: StatusOcr.CONCLUIDO }
    );
    
    // Se quiser ser mais radical e aprovar a tabela INTEIRA de uma vez, 
    // basta trocar o { aprovado: false } por {}
    
    return {
      message: 'Documentos antigos atualizados com sucesso!',
      linhasAfetadas: result.affected,
    };
  }

  // =========================================================================
  // 2. MÉTODOS ORIGINAIS DE BUSCA E MANUTENÇÃO
  // =========================================================================

  async findAll(): Promise<Documento[]> {
    return await this.documentoRepository.find({
      order: {
        date: 'DESC',
      },
    });
  }

  async findByNumber(number: string): Promise<Documento> {
    const documento = await this.documentoRepository.findOneBy({ number });
    if (!documento) {
      throw new NotFoundException(`Documento com número ${number} não encontrado`);
    }
    return documento;
  }

  async findOne(id: number): Promise<Documento> {
    const documento = await this.documentoRepository.findOneBy({ id });
    if (!documento) {
      throw new NotFoundException(`Documento com ID ${id} não encontrado`);
    }
    return documento;
  }

  /**
   * Atualiza apenas o arquivo PDF.
   * Agora utiliza nomeOriginal + UUID para evitar sobrescrita destrutiva no MinIO.
   */
  async updateFile(id: number, tempFilename: string, originalName?: string): Promise<Documento> {
    const documento = await this.findOne(id);

    // Limpa o nome original ou usa o ID como fallback
    const baseName = originalName 
      ? parse(originalName).name.replace(/[^\w\d-]/g, '') 
      : `doc-${documento.id}`;

    // Gera o nome final com UUID
    const uuid = randomUUID();
    const finalFilename = `${documento.type}/${baseName}-${uuid}.pdf`;

    let uploadResult;
    try {
      uploadResult = await this.filesService.moveTempFileToMinio(
        tempFilename,
        finalFilename,
      );
    } catch (error) {
      throw new InternalServerErrorException(
        `Erro ao substituir o arquivo PDF: ${error.message}`,
      );
    }

    documento.url = uploadResult.url;
    
    // Opcional: Descomente abaixo se quiser que o arquivo novo passe pelo OCR novamente
    // documento.status_ocr = StatusOcr.PENDENTE;
    // await this.ocrQueue.add('processar-pdf', { documentoId: documento.id, tipo: documento.type, arquivoUrl: uploadResult.url });

    const documentoSalvo = await this.documentoRepository.save(documento);
    await this._atualizarTimestamp(documentoSalvo.type);

    return documentoSalvo;
  }

  getPdfStream(filename: string) {
    const filePath = join(this.pdfDirectory, filename);

    try {
      statSync(filePath);
    } catch {
      throw new NotFoundException('Arquivo não encontrado no disco local');
    }

    const stream = createReadStream(filePath);
    const stat = statSync(filePath);
    return { stream, stat };
  }

  async atualizaData(numero: string, novaData: string): Promise<Documento> {
    const documento = await this.documentoRepository.findOneBy({
      number: numero,
    });
    if (!documento) {
      throw new NotFoundException(`Documento com número ${numero} não encontrado`);
    }
    documento.date = novaData;
    return this.documentoRepository.save(documento);
  }

  async update(id: number, updateDocumentoDto: Partial<CreateDocumentoDto>): Promise<Documento> {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { tempFilename, ...dadosParaAtualizar } = updateDocumentoDto as any;

    const documento = await this.documentoRepository.preload({
      id: id,
      ...dadosParaAtualizar,
    });

    if (!documento) {
      throw new NotFoundException(`Documento com ID ${id} não encontrado`);
    }

    const documentoAtualizado = await this.documentoRepository.save(documento);
    await this._atualizarTimestamp(documentoAtualizado.type);

    return documentoAtualizado;
  }

  async remove(id: number): Promise<void> {
    const documento = await this.documentoRepository.findOneBy({ id });
    if (!documento) {
      throw new NotFoundException(`Documento com ID ${id} não encontrado`);
    }

    const tipoDoDocumento = documento.type;
    await this.documentoRepository.remove(documento);

    await this._atualizarTimestamp(tipoDoDocumento);
  }

  private async _atualizarTimestamp(tipoDocumento: string) {
    if (!tipoDocumento) return;

    try {
      const agora = new Date();
      const tipoNormalizado = tipoDocumento.toLowerCase().trim();

      let registro = await this.atualizacaoRepository.findOneBy({ id: 1 });
      if (!registro) {
        registro = this.atualizacaoRepository.create({ id: 1 });
      }

      registro.date_total = agora;

      switch (tipoNormalizado) {
        case 'portaria':
          registro.date_portaria = agora;
          break;
        case 'lei_ordinaria':
        case 'lei ordinaria':
          registro.date_lei_ordinaria = agora;
          break;
        case 'lei_complementar':
        case 'lei complementar':
          registro.date_lei_complementar = agora;
          break;
        case 'decreto':
          registro.date_decreto = agora;
          break;
        case 'emenda':
          registro.date_emenda = agora;
          break;
        case 'lei_organica':
        case 'lei organica':
          registro.date_lei_organica = agora;
          break;
        default:
          console.warn(
            `[DocumentoService] Tipo desconhecido para timestamp: ${tipoDocumento}`,
          );
      }

      await this.atualizacaoRepository.save(registro);
    } catch (error) {
      console.error('Erro ao atualizar timestamp (não crítico):', error);
    }
  }

  // =========================================================================
  // ROTA DE EMERGÊNCIA: Reprocessar Legados
  // =========================================================================
  async reprocessarLegadosFila() {
    // Pega todos os documentos que não têm texto, mas que possuem uma URL válida
    const documentos = await this.documentoRepository.find({
      where: { 
        fullText: IsNull(),
        url: Not(IsNull()) // Garante que tem arquivo para o OCR ler
      }
    });

    const documentosValidos = documentos.filter(doc => doc.url.trim() !== '');

    for (const doc of documentosValidos) {
      // Muda o status para PROCESSANDO (para o frontend saber que está rolando)
      await this.documentoRepository.update(doc.id, { 
        status_ocr: StatusOcr.PROCESSANDO,
        aprovado: false 
      });

      // Joga na fila do BullMQ!
      await this.ocrQueue.add('processar-pdf', {
        documentoId: doc.id,
        tipo: doc.type,
        arquivoUrl: doc.url,
      });
    }

    return {
      message: 'Reprocessamento em lote iniciado com sucesso!',
      quantidadeEnviadaParaFila: documentosValidos.length,
      dica: 'Acompanhe os logs do PM2 no servidor para ver o OCR trabalhando!'
    };
  }
  
}