import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

// 1. DTO usado apenas no primeiro momento (Upload do arquivo)
export class CreateDocumentoDto {
  @IsString()
  @IsNotEmpty()
  type: string;

  @IsString()
  @IsNotEmpty()
  tempFilename: string;
}

// 2. NOVO DTO usado na hora de aprovar ou editar o documento
export class AprovarDocumentoDto {
  @IsString()
  @IsNotEmpty()
  number: string;

  @IsString()
  @IsNotEmpty()
  title: string;

  @IsString()
  @IsNotEmpty()
  date: string;

  // Description e fullText devem ser opcionais no DTO, 
  // pois às vezes o OCR pode não conseguir extrair a ementa ou texto com clareza
  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  fullText?: string;
}