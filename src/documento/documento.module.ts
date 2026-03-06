import { Module } from '@nestjs/common';
import { DocumentoService } from './documento.service';
import { DocumentoController } from './documento.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Documento } from './entities/documento.entity';
import { FilesModule } from 'src/files/files.module';
import { Atualizacao } from './entities/update.entity';
import { BullModule } from '@nestjs/bullmq';
import { OcrProcessor } from './ocr.processor';

@Module({
  imports: [
    TypeOrmModule.forFeature([Documento, Atualizacao]),
    FilesModule,
    // 2. Registro da fila para o NestJS saber que ela existe neste módulo
    BullModule.registerQueue({
      name: 'ocr-queue',
    }),
  ],
  controllers: [DocumentoController],
  providers: [DocumentoService, OcrProcessor],
})
export class DocumentoModule {}