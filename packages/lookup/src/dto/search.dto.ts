import { IsString, IsNumber, IsOptional, Min, Max } from 'class-validator';

export class SearchDto {
  @IsString()
  query: string;

  @IsNumber()
  @IsOptional()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}
