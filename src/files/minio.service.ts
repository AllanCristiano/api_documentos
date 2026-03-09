import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  CreateBucketCommand,
  HeadBucketCommand,
  CopyObjectCommand,
  DeleteObjectCommand,
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
  // Executado automaticamente quando a API sobe
  // =========================================================================
  async onModuleInit() {
    try {
      await this.s3Client.send(new HeadBucketCommand({ Bucket: this.bucketName }));
      this.logger.log(`[MinIO] Bucket "${this.bucketName}" já existe e está pronto para uso.`);
    } catch (error) {
      if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
        this.logger.warn(`[MinIO] Bucket "${this.bucketName}" não encontrado. Criando agora...`);
        try {
          await this.s3Client.send(new CreateBucketCommand({ Bucket: this.bucketName }));
          this.logger.log(`[MinIO] Bucket "${this.bucketName}" criado com sucesso!`);
        } catch (createError) {
          this.logger.error(`[MinIO] Erro ao tentar criar o bucket "${this.bucketName}"`, createError);
        }
      } else {
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

  // =========================================================================
  // NOVO: Renomeia o arquivo no MinIO (Copia para o novo destino e apaga a origem)
  // =========================================================================
  async renameFile(oldObjectName: string, newObjectName: string): Promise<string> {
    try {
      // 1. Define a fonte da cópia. O S3 V3 exige que o CopySource tenha o formato "bucket/chave"
      const copySource = `${this.bucketName}/${oldObjectName}`;

      // 2. Copia o objeto para o novo nome
      await this.s3Client.send(
        new CopyObjectCommand({
          Bucket: this.bucketName,
          CopySource: encodeURI(copySource), // encodeURI evita erros com espaços ou caracteres especiais
          Key: newObjectName,
        }),
      );

      // 3. Remove o objeto antigo
      await this.s3Client.send(
        new DeleteObjectCommand({
          Bucket: this.bucketName,
          Key: oldObjectName,
        }),
      );

      // 4. Retorna a nova URL pública
      const endpoint = this.configService.getOrThrow<string>('MINIO_ENDPOINT');
      const fileUrl = `${endpoint}/${this.bucketName}/${newObjectName}`;
      
      this.logger.log(`[MinIO] Renomeado com sucesso: de [${oldObjectName}] para [${newObjectName}]`);
      
      return fileUrl;
    } catch (error) {
      this.logger.error(`[MinIO] Erro ao renomear objeto de ${oldObjectName} para ${newObjectName}:`, error);
      throw error;
    }
  }
}