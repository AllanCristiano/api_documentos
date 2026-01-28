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
    // 'documentoData' ficará com: type, number, title, description, date, fullText
    const { tempFilename, ...documentoData } = createDocumentoDto;

    // 3. Gera o nome final do arquivo para o MinIO/Storage
    // Ex: "leis_ordinarias/8441-2026-01-02.pdf"
    const sanitizedNumber = documentoData.number.replace(/[^\w\d-]/g, ''); // Remove barras e pontos
    const finalFilename = `${documentoData.type}/${sanitizedNumber}-${documentoData.date}.pdf`;

    // 4. Move o arquivo físico (Do temp para o destino final)
    // Isso retorna a URL ou o caminho relativo salvo
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
    // Nota: Certifique-se que sua Entity 'Documento' possui os campos 'title' e 'description'
    // Se no banco for 'ementa', altere aqui: { ...documentoData, ementa: documentoData.description, ... }
    const novoDocumento = this.documentoRepository.create({
      ...documentoData,
      url: uploadResult.url, // Salva o caminho/url retornado pelo serviço de arquivos
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

  // Método para streaming de arquivo local (caso não use MinIO para download direto)
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
    // Se houver lógica de substituição de arquivo PDF na edição, 
    // ela deve ser implementada aqui (verificar se tem tempFilename no DTO)
    
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

    // Opcional: Chamar this.filesService.deleteFile(documento.url) aqui

    await this._atualizarTimestamp(tipoDoDocumento);
  }

  /**
   * Atualiza a tabela 'Atualizacao' com a data/hora atual
   */
  private async _atualizarTimestamp(tipoDocumento: string) {
    try {
      const agora = new Date();
      
      // Garante normalização (tudo minúsculo para bater com o switch)
      const tipoNormalizado = tipoDocumento.toLowerCase().trim();

      // Busca o registro único (ID 1) ou cria
      let registro = await this.atualizacaoRepository.findOneBy({ id: 1 });
      if (!registro) {
        registro = this.atualizacaoRepository.create({ id: 1 });
      }

      registro.date_total = agora;

      // Mapeamento dos tipos conforme seu banco de dados
      switch (tipoNormalizado) {
        case 'portaria':
          registro.date_portaria = agora;
          break;
        case 'lei_ordinaria':
        case 'lei ordinaria': // prevenção contra falta de underline
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