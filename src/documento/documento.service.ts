import {
  Injectable,
  NotFoundException,
  ConflictException,
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

    // <-- 2. REPOSITÓRIO INJETADO
    @InjectRepository(Atualizacao)
    private readonly atualizacaoRepository: Repository<Atualizacao>,

    private readonly filesService: FilesService,
  ) {}

  async create(createDocumentoDto: CreateDocumentoDto): Promise<Documento> {
    const documentoExistente = await this.documentoRepository.findOneBy({
      number: createDocumentoDto.number,
    });

    if (documentoExistente) {
      throw new ConflictException(
        `Documento com número ${createDocumentoDto.number} já existe`,
      );
    }

    const { tempFilename, ...documentoData } = createDocumentoDto;

    // Correção: Use 'documentoData.type' para definir o nome do arquivo
    const finalFilename = `${documentoData.type}/${documentoData.number
      .replace('_', '')
      .replace('/', '')
      .replace('.', '')}-${documentoData.date}`;

    // Correção: Nome do método 'moveTempFileToMinio'
    const uploadResult = await this.filesService.moveTempFileToMinio(
      tempFilename,
      finalFilename,
    );

    const novoDocumento = this.documentoRepository.create({
      ...documentoData,
      url: uploadResult.url,
    });

    const documentoSalvo = await this.documentoRepository.save(novoDocumento);

    // <-- 3. CHAMA A FUNÇÃO DE ATUALIZAÇÃO
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
      throw new Error(`Documento with id ${id} not found`);
    }
    return documento;
  }

  getPdfStream(filename: string) {
    const filePath = join(this.pdfDirectory, filename);

    try {
      statSync(filePath);
    } catch {
      throw new NotFoundException('Arquivo não encontrado');
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
    const documento = await this.documentoRepository.preload({
      id: id,
      ...updateDocumentoDto,
    });

    if (!documento) {
      throw new NotFoundException(`Documento com ID ${id} não encontrado`);
    }

    const documentoAtualizado = await this.documentoRepository.save(documento);

    // <-- 4. CHAMA A FUNÇÃO DE ATUALIZAÇÃO
    await this._atualizarTimestamp(documentoAtualizado.type);

    return documentoAtualizado;
  }

  async remove(id: number): Promise<void> {
    const documento = await this.documentoRepository.findOneBy({ id });
    if (!documento) {
      throw new NotFoundException(`Documento com ID ${id} não encontrado`);
    }
    
    const tipoDoDocumento = documento.type; // Salva o tipo antes de remover
    await this.documentoRepository.remove(documento);

    // <-- 5. CHAMA A FUNÇÃO DE ATUALIZAÇÃO
    await this._atualizarTimestamp(tipoDoDocumento);
  }

  // <-- 6. FUNÇÃO AUXILIAR PRIVADA
  /**
   * Atualiza a tabela 'Atualizacao' com a data/hora atual
   * para o tipo de documento específico.
   */
  private async _atualizarTimestamp(tipoDocumento: string) {
    try {
      const agora = new Date();

      // Vamos assumir que você sempre terá apenas UM registro (id: 1)
      let registro = await this.atualizacaoRepository.findOneBy({ id: 1 });

      // Se for a primeira vez, cria o registro
      if (!registro) {
        registro = this.atualizacaoRepository.create({ id: 1 });
      }

      // Atualiza a data geral
      registro.date_total = agora;

      // Atualiza a data específica do tipo
      // IMPORTANTE: Ajuste os 'cases' para os valores exatos de 'type'
      // que você salva no banco (ex: 'portaria', 'lei_ordinaria', etc.)
      switch (tipoDocumento) {
        case 'portaria':
          registro.date_portaria = agora;
          break;
        case 'lei_ordinaria':
          registro.date_lei_ordinaria = agora;
          break;
        case 'lei_complementar':
          registro.date_lei_complementar = agora;
          break;
        case 'decreto':
          registro.date_decreto = agora;
          break;
        case 'emenda':
          registro.date_emenda = agora;
          break;
        case 'lei_organica':
          registro.date_lei_organica = agora;
          break;
        default:
          console.warn(
            `[DocumentoService] Tipo de documento não mapeado para timestamp: ${tipoDocumento}`,
          );
      }

      await this.atualizacaoRepository.save(registro);

    } catch (error) {
      console.error('Erro ao atualizar o timestamp:', error);
      // Decide se quer lançar o erro ou apenas logar
      // throw new InternalServerErrorException('Falha ao atualizar timestamp');
    }
  }
}