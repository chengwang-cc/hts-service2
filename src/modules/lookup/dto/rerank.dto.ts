import {
  IsString,
  IsArray,
  IsOptional,
  ValidateNested,
  ArrayMinSize,
  ArrayMaxSize,
} from 'class-validator';
import { Type } from 'class-transformer';

export class RerankCandidateDto {
  @IsString()
  htsNumber: string;

  @IsString()
  description: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  fullDescription?: string[] | null;
}

export class RerankDto {
  @IsString()
  query: string;

  @IsArray()
  @ValidateNested({ each: true })
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @Type(() => RerankCandidateDto)
  candidates: RerankCandidateDto[];
}
