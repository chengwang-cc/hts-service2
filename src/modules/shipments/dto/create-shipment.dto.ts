import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import type { SavedShipmentStatus } from '../entities/saved-shipment.entity';

export class CreateShipmentDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsIn(['draft', 'finalized', 'archived'])
  status?: SavedShipmentStatus;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  tags?: string[];

  @IsOptional()
  @IsBoolean()
  sharedWithOrg?: boolean;

  /** Shipment payload (matches FE `Shipment` interface). */
  @IsObject()
  shipment: Record<string, unknown>;

  /** Line items payload (matches FE `LineItem[]`). */
  @IsArray()
  lines: Record<string, unknown>[];
}
