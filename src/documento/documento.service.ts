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

@Injectable()
export class DocumentoService {
  private readonly pdfDirectory = join(process.cwd(), 'pdfs');

  constructor(
    @InjectRepository(Documento)
    private readonly documentoRepository: Repository<Documento>,
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

    // 1. CORREÇÃO: Use 'documentoData.type' em vez de 'docType'
    const finalFilename = `${documentoData.number.replace('_', '-')}-${documentoData.type}`;

    // 2. CORREÇÃO: Corrija o nome do método para 'moveTempFileToMinio' (com 'o' minúsculo)
    const uploadResult = await this.filesService.moveTempFileToMinio(
      tempFilename,
      finalFilename,
    );

    const novoDocumento = this.documentoRepository.create({
      ...documentoData,
      url: uploadResult.url,
    });

    return this.documentoRepository.save(novoDocumento);
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

    // Salva a entidade atualizada
    return this.documentoRepository.save(documento);
  }
}
