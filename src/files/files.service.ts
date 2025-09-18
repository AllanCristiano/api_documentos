// src/files/files.service.ts

import { Injectable, NotFoundException } from '@nestjs/common';
import { MinioService } from './minio.service'; // Importe o MinioService
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class FilesService {
  // 1. Injete o MinioService no construtor para poder usá-lo
  constructor(private readonly minioService: MinioService) {}

  /**
   * ESTE É O NOVO MÉTODO.
   * Ele substitui a lógica do antigo 'processPdf'. Sua função é mover um
   * arquivo já salvo temporariamente para o armazenamento permanente no MinIO.
   *
   * @param tempFilename O nome do arquivo na pasta ./uploads (ex: '1678890000000-123456789.pdf').
   * @param finalFilename O nome que o arquivo deverá ter no MinIO (ex: 'Relatorio-Mensal').
   * @returns O resultado do upload, incluindo a URL final do arquivo no MinIO.
   */
  async moveTempFileToMinio(tempFilename: string, finalFilename: string) {
    // Constrói o caminho completo para o arquivo temporário
    const tempFilePath = path.join('./uploads', tempFilename);

    // a. Verifica se o arquivo temporário realmente existe no disco
    if (!fs.existsSync(tempFilePath)) {
      throw new NotFoundException(
        `Arquivo temporário ${tempFilename} não encontrado. Faça o upload novamente.`,
      );
    }

    // Garante que o nome final no MinIO tenha a extensão .pdf
    const finalFilenameWithExt = `${finalFilename}.pdf`;

    try {
      // c. Chama o serviço do MinIO para realizar o upload
      const result = await this.minioService.uploadFile(
        tempFilePath,
        finalFilenameWithExt,
      );

      // d. (Passo Crítico) APENAS APÓS o upload bem-sucedido, remove o arquivo temporário
      fs.unlinkSync(tempFilePath);

      // Retorna uma resposta de sucesso com a URL do MinIO
      return {
        message: 'Arquivo finalizado e enviado para o MinIO com sucesso!',
        ...result,
      };
    } catch (error) {
      // e. Se o upload para o MinIO falhar, o erro é capturado e relançado.
      // O arquivo temporário NÃO é excluído, permitindo uma nova tentativa.
      console.error(
        `Falha ao mover o arquivo ${tempFilename} para o MinIO.`,
        error,
      );
      throw error;
    }
  }

  // O método 'processPdf' original foi removido pois sua lógica foi
  // substituída pelo novo fluxo de duas etapas.
}
