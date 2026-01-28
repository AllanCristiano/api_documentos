import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ExpressAdapter } from '@nestjs/platform-express';
import * as express from 'express';

async function bootstrap() {
  // 1. Criamos a instância do Express manualmente
  const server = express();

  // 2. Aplicamos o limite GIGANTE direto no Express (antes do Nest tocar nele)
  server.use(express.json({ limit: '1000mb' }));
  server.use(express.urlencoded({ extended: true, limit: '1000mb' }));

  // 3. Criamos o App Nest usando essa instância já configurada
  // O terceiro argumento { bodyParser: false } garante que o Nest não tente criar outro por cima
  const app = await NestFactory.create(
    AppModule,
    new ExpressAdapter(server),
    { bodyParser: false }, 
  );

  app.enableCors({
    origin: '*',
  });

  await app.listen(3001);
}
void bootstrap();