import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  Min,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class StartParityRunDto {
  @ApiPropertyOptional({
    enum: ['smoke', 'sample', 'full', 'custom'],
    default: 'smoke',
  })
  @IsOptional()
  @IsEnum(['smoke', 'sample', 'full', 'custom'])
  scope?: 'smoke' | 'sample' | 'full' | 'custom';

  @ApiPropertyOptional({
    description: 'Chapter codes (e.g. ["61","62","84"]). Omit for all.',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(99)
  @IsString({ each: true })
  chapters?: string[];

  @ApiPropertyOptional({
    description: 'ISO-2 country list. Default: CN, MX, CA, DE, KR, RU.',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  countries?: string[];

  @ApiPropertyOptional({
    description: 'Declared-value bands in USD. Default: [50, 1000, 50000].',
    type: [Number],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsNumber({}, { each: true })
  valueBands?: number[];

  @ApiPropertyOptional({
    description: 'Subheadings per heading per rate class. Default: 3.',
    minimum: 1,
    maximum: 20,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  perHeading?: number;

  @ApiPropertyOptional({
    description: 'Override ai-service base URL (defaults to env AI_SERVICE_URL).',
  })
  @IsOptional()
  @IsUrl({ require_tld: false })
  aiServiceUrl?: string;
}

export class ReviewParityRowDto {
  @IsEnum(['untouched', 'acknowledged', 'fix_ai', 'fix_hts', 'data_fix', 'wontfix'])
  status:
    | 'untouched'
    | 'acknowledged'
    | 'fix_ai'
    | 'fix_hts'
    | 'data_fix'
    | 'wontfix';

  @IsOptional()
  @IsString()
  note?: string;
}
