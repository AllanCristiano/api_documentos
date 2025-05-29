import { Injectable } from '@nestjs/common';
import { CreateDocumentoDto } from './dto/create-documento.dto';
import { UpdateDocumentoDto } from './dto/update-documento.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { Documento } from './entities/documento.entity';
import { Repository } from 'typeorm';

@Injectable()
export class DocumentoService {
  constructor(
    @InjectRepository(Documento)
    private readonly documentoRepository: Repository<Documento>,
  ) {}
  async create(createDocumentoDto: CreateDocumentoDto): Promise<Documento> {
    const novoDocumento = this.documentoRepository.create(createDocumentoDto);
    return this.documentoRepository.save(novoDocumento);
  }

  async findAll(): Promise<Documento[]> {
    return await this.documentoRepository.find();
  }

  async findOne(id: number): Promise<Documento> {
    const documento = await this.documentoRepository.findOneBy({
      id: id,
    });
    if (!documento) {
      throw new Error(`Documento with id ${id} not found`);
    }
    return documento;
  }

  async update(
    id: number,
    updateDocumentoDto: UpdateDocumentoDto,
  ): Promise<Documento> {
    await this.documentoRepository.update(id, updateDocumentoDto);
    return this.findOne(id);
  }

  async remove(id: number): Promise<void> {
    await this.documentoRepository.delete(id);
  }
}
