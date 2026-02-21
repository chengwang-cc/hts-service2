import { IsString, IsNumber, IsOptional } from 'class-validator';

/**
 * Knowledgebase Upload Document DTO
 * Internal DTO for knowledgebase document operations
 */
export class KnowledgebaseUploadDocumentDto {
  @IsString()
  chapter: string;

  @IsNumber()
  year: number;

  @IsString()
  @IsOptional()
  documentType?: string;
}
