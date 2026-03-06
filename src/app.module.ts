import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';

import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DocumentoModule } from './documento/documento.module';
import { FilesModule } from './files/files.module';

@Module({
  imports: [
    // 1. Configurações de Ambiente
    ConfigModule.forRoot({
      isGlobal: true,
    }),

    // 2. Banco de Dados PostgreSQL
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: process.env.DB_HOST || 'localhost',
      // Ajuste aqui: Convertendo para string antes do parseInt e garantindo fallback
      port: parseInt(String(process.env.DB_PORT || 5432)),
      username: process.env.DB_USERNAME || 'usuario',
      password: process.env.DB_PASSWORD || 'senha123',
      database: process.env.DB_DATABASE || 'pma',
      autoLoadEntities: true,
      synchronize: true, 
    }),

    // 3. Configuração Global do BullMQ (Redis)
    BullModule.forRoot({
      connection: {
        host: process.env.REDIS_HOST || 'localhost',
        // Ajuste aqui: Garantindo que o valor seja string para satisfazer o TS
        port: parseInt(String(process.env.REDIS_PORT || 6379)),
      },
    }),

    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', 'public'),
      serveRoot: '/public',
    }),

    DocumentoModule,
    FilesModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}