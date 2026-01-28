import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
// Não precisamos mais importar json/urlencoded do express AQUI

async function bootstrap() {
  // MANTENHA O bodyParser: false. Isso é CRUCIAL.
  // Se tirar isso, o Nest cria o limite de 100kb antes do nosso módulo rodar.
  const app = await NestFactory.create(AppModule, { bodyParser: false });

  // Removemos os app.use() manuais daqui porque agora o AppModule cuida disso.

  app.enableCors({
    origin: '*',
  });

  await app.listen(3001);
}
void bootstrap();