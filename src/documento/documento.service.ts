import { Injectable, NotFoundException } from '@nestjs/common';
import { CreateDocumentoDto } from './dto/create-documento.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { Documento } from './entities/documento.entity';
import { Repository } from 'typeorm';
import { join } from 'path';
import { createReadStream, statSync } from 'fs';

@Injectable()
export class DocumentoService {
  private readonly pdfDirectory = join(process.cwd(), 'pdfs');

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
    const documento = await this.documentoRepository.findOneBy({ id });
    if (!documento) {
      throw new Error(`Documento with id ${id} not found`);
    }
    return documento;
  }

  getPdfStream(filename: string) {
    const filePath = join(this.pdfDirectory, filename);

    // Lança exceção se o arquivo não existir
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
    const documento = await this.documentoRepository.findOneBy({ number: numero });
    if (!documento) {
      throw new NotFoundException(`Documento com número ${numero} não encontrado`);
    }
    documento.date = novaData;
    return this.documentoRepository.save(documento);
  }

  // Método para deletar um documento
  async remove(id: string): Promise<boolean> {
    // Converte o id de string para number; 
    // o parseFloat é utilizado para capturar números com ponto (ex.: "5.660")
    const numericId = parseFloat(id);
    const documento = await this.documentoRepository.findOneBy({ id: numericId });
    if (!documento) {
      throw new NotFoundException(`Documento com id ${id} não encontrado`);
    }
    await this.documentoRepository.remove(documento);
    return true;
  }
}
