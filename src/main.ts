import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ExpressAdapter } from '@nestjs/platform-express';
import * as express from 'express';

async function bootstrap() {
 
  const server = express();

  
  server.use(express.json({ limit: '1000mb' }));
  server.use(express.urlencoded({ extended: true, limit: '1000mb' }));

  
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