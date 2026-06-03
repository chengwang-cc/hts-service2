import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsString,
  MaxLength,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * Batch HTS lookup request. Returns one entry per input code in input order,
 * with a `result` (the HTS row) or `error` (string) for each. Partial
 * failures are reported in-line — the overall response is 200 unless input
 * validation fails.
 *
 * Cap of 50 is a deliberate ceiling: at >50 codes the partner should
 * paginate or run multiple requests in parallel — keeps the SQL query
 * bounded and the response payload predictable.
 */
export class BatchLookupDto {
  @ApiProperty({
    description: 'HTS codes to look up (max 50).',
    example: ['0101.21.0000', '8471.30.0100', '6204.62.8011'],
    type: [String],
    maxItems: 50,
  })
  @IsArray()
  @ArrayMinSize(1, { message: 'codes must contain at least 1 code' })
  @ArrayMaxSize(50, { message: 'codes must contain at most 50 codes' })
  @ArrayUnique({ message: 'codes must be unique' })
  @IsString({ each: true })
  @MaxLength(20, { each: true })
  codes: string[];
}
