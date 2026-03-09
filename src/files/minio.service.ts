import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  CreateBucketCommand,
  HeadBucketCommand,
} from '@aws-sdk/client-s3';
import { readFileSync } from 'fs';

@Injectable()
export class MinioService implements OnModuleInit {
  private readonly logger = new Logger(MinioService.name);
  private readonly s3Client: S3Client;
  private readonly bucketName: string;

  constructor(private readonly configService: ConfigService) {
    this.bucketName = this.configService.getOrThrow<string>('MINIO_BUCKET');

    this.s3Client = new S3Client({
      endpoint: this.configService.getOrThrow<string>('MINIO_ENDPOINT'),
      region: 'us-east-1',
      credentials: {
        accessKeyId: this.configService.getOrThrow<string>('MINIO_ACCESS_KEY'),
        secretAccessKey:
          this.configService.getOrThrow<string>('MINIO_SECRET_KEY'),
      },
      forcePathStyle: true,
    });
  }

  // =========================================================================
  // NOVO: Executado automaticamente quando a API sobe
  // =========================================================================
  async onModuleInit() {
    try {
      // Tenta checar se o bucket já existe
      await this.s3Client.send(new HeadBucketCommand({ Bucket: this.bucketName }));
      this.logger.log(`[MinIO] Bucket "${this.bucketName}" já existe e está pronto para uso.`);
    } catch (error) {
      // O erro 404 (NotFound) significa que o bucket não existe. Vamos criar!
      if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
        this.logger.warn(`[MinIO] Bucket "${this.bucketName}" não encontrado. Criando agora...`);
        try {
          await this.s3Client.send(new CreateBucketCommand({ Bucket: this.bucketName }));
          this.logger.log(`[MinIO] Bucket "${this.bucketName}" criado com sucesso!`);
        } catch (createError) {
          this.logger.error(`[MinIO] Erro ao tentar criar o bucket "${this.bucketName}"`, createError);
        }
      } else {
        // Se for outro erro (como credenciais inválidas ou MinIO fora do ar), a gente loga
        this.logger.error(`[MinIO] Erro ao verificar o bucket "${this.bucketName}"`, error);
      }
    }
  }

  async uploadFile(filePath: string, objectName: string) {
    try {
      const fileContent = readFileSync(filePath);

      const params = {
        Bucket: this.bucketName,
        Key: objectName,
        Body: fileContent,
        ContentType: 'application/pdf',
      };

      const command = new PutObjectCommand(params);
      await this.s3Client.send(command);

      const endpoint = this.configService.getOrThrow<string>('MINIO_ENDPOINT');
      const fileUrl = `${endpoint}/${this.bucketName}/${objectName}`;

      this.logger.log(`Arquivo enviado com sucesso para MinIO: ${fileUrl}`);
      return { url: fileUrl };
    } catch (error) {
      this.logger.error('Erro ao fazer upload do arquivo para o MinIO', error);
      throw error;
    }
  }

  async downloadFile(objectName: string): Promise<Buffer> {
    try {
      const params = {
        Bucket: this.bucketName,
        Key: objectName,
      };

      const command = new GetObjectCommand(params);
      const response = await this.s3Client.send(command);

      if (response.Body) {
        const byteArray = await response.Body.transformToByteArray();
        const buffer = Buffer.from(byteArray);

        this.logger.log(`Arquivo "${objectName}" baixado com sucesso.`);
        return buffer;
      }

      throw new Error(
        `Corpo da resposta para o arquivo "${objectName}" está vazio.`,
      );
    } catch (error) {
      this.logger.error(`Erro ao baixar o arquivo "${objectName}"`, error);
      throw error;
    }
  }
}