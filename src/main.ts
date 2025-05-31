// main.ts (NestJS)
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Permitir requisições vindas do Next.js em localhost:3000
  app.enableCors({
    origin: 'http://localhost:3000',
  });

  await app.listen(3001);
}
bootstrap();
