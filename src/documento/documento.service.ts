import {
  Injectable,
  NotFoundException,
  ConflictException,
  InternalServerErrorException,
} from '@nestjs/common';
import { CreateDocumentoDto } from './dto/create-documento.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { Documento } from './entities/documento.entity';
import { Repository } from 'typeorm';
import { join } from 'path';
import { createReadStream, statSync } from 'fs';
import { FilesService } from 'src/files/files.service';
import { Atualizacao } from './entities/update.entity';

@Injectable()
export class DocumentoService {
  private readonly pdfDirectory = join(process.cwd(), 'pdfs');

  constructor(
    @InjectRepository(Documento)
    private readonly documentoRepository: Repository<Documento>,

    @InjectRepository(Atualizacao)
    private readonly atualizacaoRepository: Repository<Atualizacao>,

    private readonly filesService: FilesService,
  ) {}

  async create(createDocumentoDto: CreateDocumentoDto): Promise<Documento> {
    // 1. Verifica duplicidade
    const documentoExistente = await this.documentoRepository.findOneBy({
      number: createDocumentoDto.number,
    });

    if (documentoExistente) {
      throw new ConflictException(
        `Documento com número ${createDocumentoDto.number} já existe`,
      );
    }

    // 2. Separa o nome do arquivo temporário dos dados do documento
    const { tempFilename, ...documentoData } = createDocumentoDto;

    // 3. Gera o nome final do arquivo para o MinIO/Storage
    // NOTA: Removido o ".pdf" manual do final, pois o FilesService adiciona a extensão
    const sanitizedNumber = documentoData.number.replace(/[^\w\d-]/g, '');
    const finalFilename = `${documentoData.type}/${sanitizedNumber}-${documentoData.date}`;

    // 4. Move o arquivo físico (Do temp para o destino final)
    let uploadResult;
    try {
      uploadResult = await this.filesService.moveTempFileToMinio(
        tempFilename,
        finalFilename,
      );
    } catch (error) {
      throw new InternalServerErrorException(
        `Erro ao mover o arquivo PDF: ${error.message}`,
      );
    }

    // 5. Cria a entidade para salvar no Banco
    const novoDocumento = this.documentoRepository.create({
      ...documentoData,
      url: uploadResult.url, // Salva a URL retornada pelo MinIO
    });

    // 6. Salva no Postgres
    const documentoSalvo = await this.documentoRepository.save(novoDocumento);

    // 7. Atualiza o timestamp da dashboard
    await this._atualizarTimestamp(documentoSalvo.type);

    return documentoSalvo;
  }

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
      throw new NotFoundException(
        `Documento com número ${number} não encontrado`,
      );
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
   * NOVO MÉTODO: Atualiza apenas o arquivo PDF de um documento existente.
   * O novo arquivo deve ter sido enviado previamente para a pasta temporária.
   */
  async updateFile(id: number, tempFilename: string): Promise<Documento> {
    // 1. Busca o documento existente
    const documento = await this.findOne(id);

    // 2. Gera o nome final do arquivo (Mesma lógica do create para manter consistência)
    // Isso garante que ele vai sobrescrever o arquivo correto no MinIO
    const sanitizedNumber = documento.number.replace(/[^\w\d-]/g, '');

    // IMPORTANTE: Sem adicionar .pdf manualmente aqui também
    const finalFilename = `${documento.type}/${sanitizedNumber}-${documento.date}`;

    // 3. Move o arquivo físico (Do temp para o destino final)
    let uploadResult;
    try {
      // O MinIO irá sobrescrever o arquivo antigo automaticamente se o nome for igual
      uploadResult = await this.filesService.moveTempFileToMinio(
        tempFilename,
        finalFilename,
      );
    } catch (error) {
      throw new InternalServerErrorException(
        `Erro ao substituir o arquivo PDF: ${error.message}`,
      );
    }

    // 4. Atualiza a URL na entidade (caso o bucket ou caminho mude)
    documento.url = uploadResult.url;

    // 5. Salva no banco
    const documentoSalvo = await this.documentoRepository.save(documento);

    // 6. Atualiza o timestamp da dashboard
    await this._atualizarTimestamp(documentoSalvo.type);

    return documentoSalvo;
  }

  // Método para streaming de arquivo local
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
      throw new NotFoundException(
        `Documento com número ${numero} não encontrado`,
      );
    }
    documento.date = novaData;
    return this.documentoRepository.save(documento);
  }

  async update(
    id: number,
    updateDocumentoDto: Partial<CreateDocumentoDto>,
  ): Promise<Documento> {
    // Remove tempFilename do update para não quebrar o preload
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
}