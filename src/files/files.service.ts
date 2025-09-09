import { Injectable } from '@nestjs/common';

@Injectable()
export class FilesService {
  processPdf(file: Express.Multer.File) {
    // Aqui você pode adicionar a lógica para processar o PDF
    // Por exemplo, ler o conteúdo, extrair texto, salvar informações no banco de dados, etc.
    return {
      message: 'Arquivo PDF recebido com sucesso!',
      filename: file.filename,
      path: file.path,
    };
  }
}
