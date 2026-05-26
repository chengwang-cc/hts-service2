import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsDateString,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

/**
 * Body for `PUT /admin/exception-rules/:id/status`.
 *
 * Operators flip a rule on/off (optionally bounded by an effective
 * window) and supply a free-text reason that the audit log keeps with
 * the change.
 */
export class RuleStatusUpdateDto {
  @ApiProperty({ example: false })
  @IsBoolean()
  enabled: boolean;

  @ApiPropertyOptional({ example: '2026-06-01T00:00:00.000Z', nullable: true })
  @IsOptional()
  @IsDateString()
  effectiveFrom?: string | null;

  @ApiPropertyOptional({ example: null, nullable: true })
  @IsOptional()
  @IsDateString()
  effectiveTo?: string | null;

  @ApiPropertyOptional({
    example: 'Paused while CSMS 65340246 review is in progress',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string | null;
}
