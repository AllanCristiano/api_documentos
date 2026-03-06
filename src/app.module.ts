import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DocumentoModule } from './documento/documento.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FilesModule } from './files/files.module';
import { ConfigModule } from '@nestjs/config';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';

// 1. IMPORTANDO O BULLMODULE AQUI
import { BullModule } from '@nestjs/bullmq'; 

@Module({
  imports: [
    DocumentoModule,
    
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: 'localhost',
      port: 5433,
      username: 'usuario',
      password: 'senha123',
      database: 'pma',
      autoLoadEntities: true,
      synchronize: true,
    }),
    
    // =========================================================
    // 2. ADICIONANDO A CONFIGURAÇÃO GLOBAL DA FILA (REDIS)
    // =========================================================
    BullModule.forRoot({
      connection: {
        host: 'localhost', // O Docker expõe a porta para o seu localhost
        port: 6379,
      },
    }),

    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', 'public'),
    }),
    
    ConfigModule.forRoot({ isGlobal: true }),
    
    FilesModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}