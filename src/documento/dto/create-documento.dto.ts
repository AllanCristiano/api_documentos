import { IsNotEmpty, IsString } from 'class-validator';

export class CreateDocumentoDto {
  @IsString()
  @IsNotEmpty()
  type: string;

  @IsString()
  @IsNotEmpty()
  number: string;

  @IsString()
  @IsNotEmpty()
  title: string;

  @IsString()
  @IsNotEmpty()
  description: string;

  @IsString()
  @IsNotEmpty()
  date: string;

  @IsString()
  @IsNotEmpty()
  tempFilename: string;

  @IsString()
  @IsNotEmpty()
  fullText: string;
}
