import { IsString, IsNumber, IsOptional } from 'class-validator';

export class UploadDocumentDto {
  @IsString()
  chapter: string;

  @IsNumber()
  year: number;

  @IsString()
  @IsOptional()
  documentType?: string;
}
