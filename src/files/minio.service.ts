// src/files/minio.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { readFileSync } from 'fs';

@Injectable()
export class MinioService {
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

      // 🔧 CORREÇÃO AQUI: Verifique se o Body existe
      if (response.Body) {
        // O corpo da resposta (Body) é um stream. Precisamos convertê-lo para um Buffer.
        const byteArray = await response.Body.transformToByteArray();
        const buffer = Buffer.from(byteArray);

        this.logger.log(`Arquivo "${objectName}" baixado com sucesso.`);
        return buffer;
      }

      // Se o Body não existir, lance um erro
      throw new Error(
        `Corpo da resposta para o arquivo "${objectName}" está vazio.`,
      );
    } catch (error) {
      this.logger.error(`Erro ao baixar o arquivo "${objectName}"`, error);
      throw error;
    }
  }
}
