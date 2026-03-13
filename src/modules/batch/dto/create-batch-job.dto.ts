import {
  IsString,
  IsArray,
  IsOptional,
  IsIn,
  ValidateNested,
  ArrayMinSize,
  ArrayMaxSize,
  IsObject,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';

export class BatchItemDto {
  @IsString()
  query: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  referenceId?: string;
}

export class CreateBatchJobDto {
  @IsIn(['autocomplete', 'deep_search'])
  method: 'autocomplete' | 'deep_search';

  @IsArray()
  @ValidateNested({ each: true })
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @Type(() => BatchItemDto)
  items: BatchItemDto[];

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
