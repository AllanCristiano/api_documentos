import { Module, forwardRef } from '@nestjs/common';
import { DocumentoService } from './documento.service';
import { DocumentoController } from './documento.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Documento } from './entities/documento.entity';
import { FilesModule } from '../files/files.module'; // Use caminhos relativos para evitar erros de build
import { Atualizacao } from './entities/update.entity';
import { BullModule } from '@nestjs/bullmq';
import { OcrProcessor } from './ocr.processor';

@Module({
  imports: [
    TypeOrmModule.forFeature([Documento, Atualizacao]),
    
    // 1. CORREÇÃO: Usando forwardRef para quebrar a dependência circular com FilesModule
    forwardRef(() => FilesModule),

    // 2. Registro da fila neste módulo
    BullModule.registerQueue({
      name: 'ocr-queue',
    }),
  ],
  controllers: [DocumentoController],
  // 3. OcrProcessor como provider para o NestJS gerenciar o ciclo de vida do Worker
  providers: [DocumentoService, OcrProcessor],
  // 4. Exporte o DocumentoService para que o FilesModule (ou o Processor) possa usá-lo
  exports: [DocumentoService],
})
export class DocumentoModule {}