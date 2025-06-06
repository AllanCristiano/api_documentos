import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DocumentoModule } from './documento/documento.module';
import { TypeOrmModule } from '@nestjs/typeorm';

@Module({
  imports: [
    DocumentoModule,
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: 'localhost',
      port: 5432,
      username: 'usuario',
      password: 'senha123',
      database: 'pma',
      autoLoadEntities: true,
      synchronize: true,
    }),
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
