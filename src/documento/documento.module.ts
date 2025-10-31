import { Module } from '@nestjs/common';
import { DocumentoService } from './documento.service';
import { DocumentoController } from './documento.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Documento } from './entities/documento.entity';
import { FilesModule } from 'src/files/files.module';
import { Atualizacao } from './entities/update.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Documento, Atualizacao]), FilesModule],
  controllers: [DocumentoController],
  providers: [DocumentoService],
})
export class DocumentoModule {}
