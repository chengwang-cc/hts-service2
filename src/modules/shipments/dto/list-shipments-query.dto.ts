import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import type { SavedShipmentStatus } from '../entities/saved-shipment.entity';

export class ListShipmentsQueryDto {
  /**
   * Free-text search against name + description (pg_trgm) and any line's
   * htsNumber / description. Empty / undefined returns the full set scoped
   * to the caller's organization.
   */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  q?: string;

  @IsOptional()
  @IsString()
  @MaxLength(8)
  destination?: string;

  @IsOptional()
  @IsString()
  @MaxLength(8)
  origin?: string;

  @IsOptional()
  @IsIn(['draft', 'finalized', 'archived'])
  status?: SavedShipmentStatus;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  tag?: string;

  @IsOptional()
  @IsISO8601()
  createdAfter?: string;

  @IsOptional()
  @IsISO8601()
  createdBefore?: string;

  @IsOptional()
  @IsIn(['lastOpenedAt', 'updatedAt', 'createdAt', 'name'])
  sort?: 'lastOpenedAt' | 'updatedAt' | 'createdAt' | 'name';

  @IsOptional()
  @IsIn(['asc', 'desc'])
  order?: 'asc' | 'desc';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}
