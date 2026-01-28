import { Module, NestModule, MiddlewareConsumer, RequestMethod } from '@nestjs/common'; // <--- Adicione NestModule e MiddlewareConsumer
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DocumentoModule } from './documento/documento.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FilesModule } from './files/files.module';
import { ConfigModule } from '@nestjs/config';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import { json, urlencoded } from 'express'; // <--- Importante

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
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', 'public'),
    }),
    ConfigModule.forRoot({ isGlobal: true }),
    FilesModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule implements NestModule { // <--- Implementa NestModule
  configure(consumer: MiddlewareConsumer) {
    // Aplica o limite GIGANTE para todas as rotas
    consumer
      .apply(json({ limit: '1000mb' }), urlencoded({ extended: true, limit: '1000mb' }))
      .forRoutes({ path: '*', method: RequestMethod.ALL });
  }
}