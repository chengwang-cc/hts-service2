import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsOptional,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { CalculatePublicDto } from './calculate-public.dto';

/**
 * Batch calculation request. Items are processed with bounded concurrency;
 * per-item failures are returned in-line as `{ ok: false, error }` so a bad
 * SKU doesn't fail the whole cart.
 *
 * `persistHistory` defaults to FALSE for batch (vs. true for single-item)
 * because checkout volume can quickly bloat `calculation_history`. Set
 * explicitly when you do want the rows (e.g. fulfillment workflow).
 */
export class CalculateBatchPublicDto {
  @ApiProperty({
    description: 'Calculator inputs, one per cart line item (max 50).',
    type: [CalculatePublicDto],
    maxItems: 50,
  })
  @IsArray()
  @ArrayMinSize(1, { message: 'items must contain at least 1 entry' })
  @ArrayMaxSize(50, { message: 'items must contain at most 50 entries' })
  @ValidateNested({ each: true })
  @Type(() => CalculatePublicDto)
  items: CalculatePublicDto[];

  @ApiProperty({
    description:
      'If true, persist each calculation to calculation_history. Default false for batch — write-amplification at checkout volume would dominate the table.',
    required: false,
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  persistHistory?: boolean;
}
