import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * One line item in an async batch classification job. `query` is a product
 * description (or a partial HTS prefix when method=autocomplete). The optional
 * `referenceId` is echoed back on every result row so the caller can join the
 * async results back to their own records (SKU, cart line id, …) without
 * relying on input order.
 */
export class BatchAsyncItemDto {
  @ApiProperty({
    description: 'Product description (deep_search) or HTS prefix (autocomplete).',
    example: 'cotton crew-neck t-shirt',
  })
  @IsString()
  @MaxLength(1000)
  query: string;

  @ApiPropertyOptional({
    description:
      'Caller-supplied identifier echoed back on the matching result row (e.g. your SKU or cart-line id).',
    example: 'SKU-12345',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  referenceId?: string;
}

/**
 * Async batch classification request (JSON payload).
 *
 * Unlike the synchronous POST /api/v1/hts/lookup/batch (exact-code lookup,
 * answered in the same request), this endpoint enqueues a background job and
 * returns immediately with a job id. The caller then polls
 * GET /api/v1/hts/batch/:jobId until status is `completed`, and reads results
 * from GET /api/v1/hts/batch/:jobId/items.
 *
 * Cap of 500 items per job matches the authenticated-owner ceiling enforced by
 * BatchJobService; larger workloads should be split across multiple jobs.
 */
export class BatchAsyncDto {
  @ApiProperty({
    description:
      'Classification method. `deep_search` runs the full hybrid (lexical + semantic) classifier per item; `autocomplete` runs the fast prefix/keyword matcher.',
    enum: ['autocomplete', 'deep_search'],
    example: 'deep_search',
  })
  @IsIn(['autocomplete', 'deep_search'])
  method: 'autocomplete' | 'deep_search';

  @ApiProperty({
    description: 'Items to classify (1–500).',
    type: [BatchAsyncItemDto],
    maxItems: 500,
  })
  @IsArray()
  @ArrayMinSize(1, { message: 'items must contain at least 1 entry' })
  @ArrayMaxSize(500, { message: 'items must contain at most 500 entries' })
  @ValidateNested({ each: true })
  @Type(() => BatchAsyncItemDto)
  items: BatchAsyncItemDto[];

  @ApiPropertyOptional({
    description:
      'Opaque metadata stored with the job and returned on status reads. Use it to tag the job (e.g. source system, run id).',
    example: { source: 'checkout', runId: '2026-06-17-a' },
  })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
