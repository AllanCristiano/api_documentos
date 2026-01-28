// main.ts (NestJS)
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { json, urlencoded } from 'express';

async function bootstrap() {
  // AQUI ESTÁ O SEGREDO: { bodyParser: false }
  // Isso impede o Nest de criar o limitador de 100kb padrão
  const app = await NestFactory.create(AppModule, { bodyParser: false });

  // Agora suas configurações mandam
  app.use(json({ limit: '1000mb' }));
  app.use(urlencoded({ extended: true, limit: '1000mb' }));

  app.enableCors({
    origin: '*',
  });

  await app.listen(3001);
}
void bootstrap();