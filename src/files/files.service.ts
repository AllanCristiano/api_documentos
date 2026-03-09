import { 
  Injectable, 
  NotFoundException, 
  Logger, 
  InternalServerErrorException 
} from '@nestjs/common';
import { MinioService } from './minio.service';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class FilesService {
  private readonly logger = new Logger(FilesService.name);

  // 1. Injete o MinioService no construtor
  constructor(private readonly minioService: MinioService) {}

  /**
   * Faz o download de um arquivo do MinIO e retorna como Buffer.
   * Útil para o processamento de OCR em segundo plano.
   * @param objectName O nome (Key) do objeto no MinIO (ex: 'LEI_ORDINARIA/arquivo.pdf').
   */
  async downloadFileFromMinio(objectName: string): Promise<Buffer> {
    try {
      // Limpeza básica: remove barras iniciais se existirem para evitar erro de objeto inválido
      const cleanKey = objectName.startsWith('/') ? objectName.substring(1) : objectName;

      this.logger.debug(`Solicitando download do objeto: ${cleanKey}`);
      
      const fileBuffer = await this.minioService.downloadFile(cleanKey);
      
      if (!fileBuffer || fileBuffer.length === 0) {
        throw new Error('O conteúdo do arquivo retornado está vazio.');
      }

      return fileBuffer;
    } catch (error) {
      this.logger.error(`Falha ao buscar o arquivo "${objectName}" do MinIO.`, error.stack);
      
      throw new NotFoundException(
        `Arquivo "${objectName}" não encontrado no armazenamento permanente.`,
      );
    }
  }

  /**
   * Move o arquivo da pasta temporária ./uploads para o MinIO.
   * @param tempFilename Nome do arquivo gerado pelo Multer no disco.
   * @param finalFilename Nome amigável/final desejado (ex: 'DECRETO/123-2024').
   */
  async moveTempFileToMinio(tempFilename: string, finalFilename: string) {
    // Localização do arquivo no servidor
    const tempFilePath = path.join('./uploads', tempFilename);

    // a. Verifica existência física
    if (!fs.existsSync(tempFilePath)) {
      throw new NotFoundException(
        `Arquivo temporário ${tempFilename} não encontrado. O upload inicial pode ter falhado.`,
      );
    }

    // b. Normaliza a extensão .pdf
    let finalFilenameWithExt = finalFilename;
    if (!finalFilenameWithExt.toLowerCase().endsWith('.pdf')) {
      finalFilenameWithExt = `${finalFilenameWithExt}.pdf`;
    }

    try {
      this.logger.log(`Movendo arquivo temporário para MinIO: ${finalFilenameWithExt}`);

      // c. Executa o upload para o MinIO (via MinioService)
      const result = await this.minioService.uploadFile(
        tempFilePath,
        finalFilenameWithExt,
      );

      // d. Limpeza do disco local: APENAS após confirmação de sucesso do MinIO
      if (fs.existsSync(tempFilePath)) {
        fs.unlinkSync(tempFilePath);
        this.logger.debug(`Arquivo temporário ${tempFilename} removido do disco.`);
      }

      return {
        message: 'Arquivo finalizado e enviado para o MinIO com sucesso!',
        url: result.url,
        key: finalFilenameWithExt, // Retornamos a key para facilitar o uso no Job de OCR
      };
    } catch (error) {
      this.logger.error(
        `Erro no processo de movimentação para o MinIO: ${tempFilename}`,
        error,
      );
      // Não removemos o arquivo temporário em caso de erro para permitir retry manual se necessário
      throw error;
    }
  }

  /**
   * NOVO: Renomeia (move) um arquivo no MinIO. Usado quando um documento é aprovado.
   * @param oldKey A chave antiga (ex: 'LEI_ORDINARIA/pendente-123-arquivo.pdf')
   * @param newKey A chave nova e definitiva (ex: 'LEI_ORDINARIA/LEI_123-2024.pdf')
   */
  async renameFileInMinio(oldKey: string, newKey: string): Promise<string> {
    try {
      const cleanOldKey = oldKey.startsWith('/') ? oldKey.substring(1) : oldKey;
      const cleanNewKey = newKey.startsWith('/') ? newKey.substring(1) : newKey;

      this.logger.log(`Renomeando no MinIO: de [${cleanOldKey}] para [${cleanNewKey}]`);
      
      // Usa o método de renomear do MinioService
      const resultUrl = await this.minioService.renameFile(cleanOldKey, cleanNewKey);
      
      return resultUrl;
    } catch (error) {
      this.logger.error(`Erro ao renomear arquivo de ${oldKey} para ${newKey}:`, error);
      throw new InternalServerErrorException('Falha ao renomear o arquivo no armazenamento permanente.');
    }
  }
}