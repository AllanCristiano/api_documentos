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
import { join, parse } from 'path';
import { createReadStream, statSync } from 'fs';
import { randomUUID } from 'crypto';

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
   * 🔧 ATUALIZADO COM TRAVA DE SEGURANÇA PARA PRESERVAR DADOS ANTIGOS.
   */
  async atualizarDadosOcr(id: number, dadosOcr: Partial<Documento>): Promise<void> {
    const documento = await this.findOne(id);

    // 1. TRAVA DE SEGURANÇA: Só atualiza se o dado novo existir E o antigo estiver vazio
    if (dadosOcr.number && !documento.number) documento.number = dadosOcr.number;
    if (dadosOcr.title && !documento.title) documento.title = dadosOcr.title;
    if (dadosOcr.date && !documento.date) documento.date = dadosOcr.date;
    
    // 2. ATUALIZAÇÃO DE TEXTO: Só substitui se o OCR realmente mandou algum texto
    if (dadosOcr.description !== undefined) documento.description = dadosOcr.description;
    if (dadosOcr.fullText !== undefined) documento.fullText = dadosOcr.fullText;
    
    // 3. CONTROLE DE STATUS: Aceita o status que vier (PROCESSANDO, CONCLUIDO, ERRO)
    if (dadosOcr.status_ocr !== undefined) documento.status_ocr = dadosOcr.status_ocr;
    if (dadosOcr.mensagem_erro !== undefined) documento.mensagem_erro = dadosOcr.mensagem_erro;

    await this.documentoRepository.save(documento);
  }

  /**
   * Passo 3: O usuário revisa os dados na interface e aprova a publicação.
   * 🔧 ATUALIZADO: Agora renomeia o arquivo no MinIO para o formato definitivo!
   */
  async aprovarDocumento(id: number, dadosAprovados: Partial<Documento>): Promise<Documento> {
    const documento = await this.findOne(id);

    // 1. Checagem de conflito
    if (dadosAprovados.number && dadosAprovados.number !== documento.number) {
      const conflito = await this.documentoRepository.findOneBy({ number: dadosAprovados.number, type: documento.type });
      if (conflito && conflito.id !== documento.id) {
        throw new ConflictException(`Documento com número ${dadosAprovados.number} já existe.`);
      }
    }

    let urlDefinitiva = documento.url;

    // 2. Renomear o arquivo no MinIO (Tirar o "pendente-")
    if (documento.url && documento.url.includes('pendente-')) {
      try {
        const bucketMatch = documento.url.match(/atos-normativos\/(.*)/);
        
        if (bucketMatch && bucketMatch[1]) {
          const oldKey = bucketMatch[1];
          
          const numLimpo = dadosAprovados.number 
            ? dadosAprovados.number.replace(/[./]/g, '-') 
            : `sem-numero-${Date.now()}`;
          
          const dataDoc = dadosAprovados.date || new Date().toISOString().split('T')[0];

          const newKey = `${documento.type}/${documento.type}_${numLimpo}_${dataDoc}.pdf`;

          urlDefinitiva = await this.filesService.renameFileInMinio(oldKey, newKey);
        }
      } catch (err) {
        console.error(`Erro não crítico ao tentar renomear o arquivo definitivo do documento ID ${id}:`, err);
      }
    }

    // 3. Atualiza os dados no banco, marca como aprovado e salva a URL nova
    Object.assign(documento, {
      ...dadosAprovados,
      url: urlDefinitiva,
      aprovado: true,
    });

    const docSalvo = await this.documentoRepository.save(documento);
    
    // Atualiza a dashboard apenas quando o documento é oficialmente aprovado
    await this._atualizarTimestamp(docSalvo.type);

    return docSalvo;
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
  // ROTAS DE EMERGÊNCIA / MANUTENÇÃO
  // =========================================================================
  
  async reprocessarLegadosFila() {
    const documentos = await this.documentoRepository.find({
      where: { 
        fullText: IsNull(),
        url: Not(IsNull())
      }
    });

    const documentosValidos = documentos.filter(doc => doc.url.trim() !== '');

    for (const doc of documentosValidos) {
      await this.documentoRepository.update(doc.id, { 
        status_ocr: StatusOcr.PROCESSANDO,
        aprovado: false 
      });

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

  // =========================================================================
  // ROTA DEFINITIVA: Padronizar nomes no MinIO e URLs no Banco de Dados
  // =========================================================================
  async padronizarTodosAprovados() {
    // 1. Pega TODOS os documentos aprovados na tabela
    const documentos = await this.documentoRepository.find({
      where: { aprovado: true }
    });

    let sucesso = 0;
    let ignorados = 0;
    let falha = 0;

    for (const doc of documentos) {
      try {
        if (!doc.url) continue;

        // Pega o que vem depois do nome do bucket (atos-normativos/)
        const bucketMatch = doc.url.match(/atos-normativos\/(.*)/);
        
        if (bucketMatch && bucketMatch[1]) {
          const oldKey = bucketMatch[1]; 
          
          // Monta as partes do nome padrão
          const numLimpo = doc.number 
            ? doc.number.replace(/[./]/g, '-') 
            : `sem-numero-${doc.id}`;
          const dataDoc = doc.date || new Date().toISOString().split('T')[0];

          // Cria a chave padrão definitiva (ex: LEI_ORDINARIA/LEI_ORDINARIA_6295_2025-12-31.pdf)
          const newKey = `${doc.type}/${doc.type}_${numLimpo}_${dataDoc}.pdf`;

          // Se a URL do banco já é idêntica ao padrão novo, não faz nada
          if (oldKey === newKey) {
            ignorados++;
            continue;
          }

          // 1. Muda o nome fisicamente lá no MinIO
          const novaUrl = await this.filesService.renameFileInMinio(oldKey, newKey);

          // 2. Muda na tabela do Banco de Dados
          doc.url = novaUrl;
          await this.documentoRepository.save(doc);
          
          sucesso++;
        }
      } catch (err) {
        console.error(`Falha ao padronizar o documento ID ${doc.id}:`, err);
        falha++;
      }
    }

    return {
      message: 'Padronização de URLs e arquivos concluída!',
      totalAnalisados: documentos.length,
      atualizadosNoMinioENoBanco: sucesso,
      jaEstavamNoPadrao: ignorados,
      falhas: falha
    };
  }
}