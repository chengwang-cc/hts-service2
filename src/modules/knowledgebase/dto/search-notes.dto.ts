import { IsString, IsOptional, IsNumber, Min, Max } from 'class-validator';

export class SearchNotesDto {
  @IsString()
  query: string;

  @IsNumber()
  @IsOptional()
  @Min(1)
  @Max(100)
  limit?: number = 10;

  @IsString()
  @IsOptional()
  chapter?: string;
}
