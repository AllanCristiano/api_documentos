// src/files/minio.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { readFileSync } from 'fs';

@Injectable()
export class MinioService {
  private readonly logger = new Logger(MinioService.name);
  private readonly s3Client: S3Client;
  private readonly bucketName: string;

  constructor(private readonly configService: ConfigService) {
    // CORREÇÃO: Use getOrThrow para garantir que o valor não seja undefined
    this.bucketName = this.configService.getOrThrow<string>('MINIO_BUCKET');

    this.s3Client = new S3Client({
      // CORREÇÃO: Aplicada a todas as chamadas get()
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
}
