import {
  Injectable,
  NotFoundException,
  ConflictException,
  InternalServerErrorException, // 👈 Importe esta exceção
} from '@nestjs/common';
import { CreateDocumentoDto } from './dto/create-documento.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { Documento } from './entities/documento.entity';
import { Repository } from 'typeorm';
import { join } from 'path';
import { createReadStream, statSync } from 'fs';
import { rename } from 'fs/promises'; 

@Injectable()
export class DocumentoService {
  // Defina os diretórios de origem e destino
  private readonly originDirectory = '/home/allan/Documentos/api_documentos/storage';
  private readonly destinationDirectory = '/home/allan/Documentos/api_documentos/processed'; // Ex: uma pasta para arquivos processados

  private readonly pdfDirectory = join(process.cwd(), 'pdfs');

  constructor(
    @InjectRepository(Documento)
    private readonly documentoRepository: Repository<Documento>,
  ) {}

  async create(createDocumentoDto: CreateDocumentoDto): Promise<Documento> {
    // 1. Busca se já existe um documento com o mesmo número
    const documentoExistente = await this.documentoRepository.findOneBy({
      number: createDocumentoDto.number,
    });

    if (documentoExistente) {
      throw new ConflictException(
        `Documento com número ${createDocumentoDto.number} já existe`,
      );
    }

    // --- LÓGICA PARA MOVER O ARQUIVO ---
    // Supondo que o DTO contenha o nome do arquivo, ex: 'documento-123.pdf'
    // Se o nome do arquivo não vier no DTO, você precisará obtê-lo de outra forma.
    const filename = createDocumentoDto.number + '_' + createDocumentoDto.date + '.pdf';

    const sourcePath = join(this.originDirectory, filename);
    const destinationPath = join(this.destinationDirectory, filename);

    try {
      // 2. Tenta mover o arquivo do diretório de origem para o de destino
      await rename(sourcePath, destinationPath);
      console.log(`Arquivo ${filename} movido com sucesso!`);
    } catch (error) {
      // 3. Se ocorrer um erro (ex: arquivo não existe), lança uma exceção
      console.error('Erro ao mover o arquivo:', error);
      if (error.code === 'ENOENT') { // ENOENT = Error NO ENTry (arquivo não encontrado)
        throw new NotFoundException(`O arquivo de origem ${filename} não foi encontrado.`);
      }
      throw new InternalServerErrorException('Não foi possível processar o arquivo do documento.');
    }

    // 4. Se o arquivo foi movido com sucesso, cria e salva o registro no banco
    const novoDocumento = this.documentoRepository.create(createDocumentoDto);
    return this.documentoRepository.save(novoDocumento);
  }

  // ... o resto dos seus métodos permanece igual ...
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
}
