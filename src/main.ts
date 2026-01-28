// main.ts (NestJS)
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { json, urlencoded } from 'express'; // 1. Importar isso

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // 2. Aumentar o limite para JSON (ajuste '50mb' conforme sua necessidade)
  app.use(json({ limit: '100mb' }));

  // 3. Aumentar o limite para URL Encoded (necessário para formulários)
  app.use(urlencoded({ extended: true, limit: '100mb' }));

  // Permitir requisições vindas de qualquer origem
  app.enableCors({
    origin: '*',
  });

  await app.listen(3001);
}
void bootstrap();