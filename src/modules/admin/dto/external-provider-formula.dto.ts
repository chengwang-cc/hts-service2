import {
  IsString,
  IsOptional,
  IsNumber,
  IsBoolean,
  IsObject,
  IsDateString,
  Min,
  Max,
  IsIn,
  IsUUID,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class UpsertExternalProviderFormulaDto {
  @ApiProperty({
    description: 'External provider code',
    example: 'FLEXPORT',
  })
  @IsString()
  provider: string;

  @ApiProperty({
    description: 'HTS number',
    example: '4820.10.20.10',
  })
  @IsString()
  htsNumber: string;

  @ApiProperty({
    description: 'ISO country code',
    example: 'CN',
  })
  @IsString()
  countryCode: string;

  @ApiProperty({
    description: 'Entry date used by provider calculation',
    example: '2026-02-15',
  })
  @IsDateString()
  entryDate: string;

  @ApiPropertyOptional({
    description: 'Mode of transport',
    example: 'OCEAN',
    default: 'OCEAN',
  })
  @IsOptional()
  @IsString()
  modeOfTransport?: string;

  @ApiProperty({
    description: 'Canonical provider input context',
    example: {
      value: 10000,
      chapter99Selections: { '9903.88.15': true },
      spiSelections: {},
      dateOfLoading: '2026-02-15',
    },
  })
  @IsObject()
  inputContext: Record<string, any>;

  @ApiPropertyOptional({
    description: 'Raw formula text as retrieved from provider',
  })
  @IsOptional()
  @IsString()
  formulaRaw?: string;

  @ApiPropertyOptional({
    description: 'Normalized formula used for deterministic comparison',
  })
  @IsOptional()
  @IsString()
  formulaNormalized?: string;

  @ApiPropertyOptional({
    description: 'Structured formula components',
  })
  @IsOptional()
  @IsObject()
  formulaComponents?: Record<string, any>;

  @ApiPropertyOptional({
    description: 'Provider output breakdown used in comparison',
  })
  @IsOptional()
  @IsObject()
  outputBreakdown?: Record<string, any>;

  @ApiPropertyOptional({
    description: 'How result was extracted from provider',
    enum: ['NETWORK', 'DOM', 'MANUAL', 'API', 'AI'],
    default: 'NETWORK',
  })
  @IsOptional()
  @IsIn(['NETWORK', 'DOM', 'MANUAL', 'API', 'AI'])
  extractionMethod?: string;

  @ApiPropertyOptional({
    description: 'Extraction confidence (0-1)',
    example: 0.92,
    default: 0,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1)
  extractionConfidence?: number;

  @ApiPropertyOptional({
    description: 'Provider parser version',
    example: 'flexport-v1',
    default: 'v1',
  })
  @IsOptional()
  @IsString()
  parserVersion?: string;

  @ApiProperty({
    description: 'Provider result URL',
    example: 'https://tariffs.flexport.com/?htsCode=4820.10.20.10',
  })
  @IsString()
  sourceUrl: string;

  @ApiPropertyOptional({
    description: 'Evidence payload (screenshots, HAR refs, snippets)',
  })
  @IsOptional()
  @IsObject()
  evidence?: Record<string, any>;

  @ApiPropertyOptional({
    description: 'Observed timestamp',
    example: '2026-02-16T03:50:00.000Z',
  })
  @IsOptional()
  @IsDateString()
  observedAt?: string;

  @ApiPropertyOptional({
    description: 'When true, existing latest snapshot for same context is superseded if changed',
    default: true,
  })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  upsertLatest?: boolean = true;
}

export class ListExternalProviderFormulasDto {
  @ApiPropertyOptional({ description: 'Provider filter', example: 'FLEXPORT' })
  @IsOptional()
  @IsString()
  provider?: string;

  @ApiPropertyOptional({ description: 'HTS number filter', example: '4820.10.20.10' })
  @IsOptional()
  @IsString()
  htsNumber?: string;

  @ApiPropertyOptional({ description: 'Country filter', example: 'CN' })
  @IsOptional()
  @IsString()
  countryCode?: string;

  @ApiPropertyOptional({ description: 'Mode filter', example: 'OCEAN' })
  @IsOptional()
  @IsString()
  modeOfTransport?: string;

  @ApiPropertyOptional({ description: 'Entry date filter', example: '2026-02-15' })
  @IsOptional()
  @IsDateString()
  entryDate?: string;

  @ApiPropertyOptional({ description: 'Show latest records only', default: true })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  isLatest?: boolean = true;

  @ApiPropertyOptional({
    description: 'Review status filter',
    enum: ['PENDING', 'APPROVED', 'REJECTED', 'PUBLISHED'],
  })
  @IsOptional()
  @IsIn(['PENDING', 'APPROVED', 'REJECTED', 'PUBLISHED'])
  reviewStatus?: string;

  @ApiPropertyOptional({ description: 'Page number (1-indexed)', default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ description: 'Page size', default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(100)
  pageSize?: number = 20;
}

export class CompareExternalProviderFormulaDto {
  @ApiProperty({ description: 'External provider code', example: 'FLEXPORT' })
  @IsString()
  provider: string;

  @ApiProperty({ description: 'HTS number', example: '4820.10.20.10' })
  @IsString()
  htsNumber: string;

  @ApiProperty({ description: 'ISO country code', example: 'CN' })
  @IsString()
  countryCode: string;

  @ApiProperty({ description: 'Entry date', example: '2026-02-15' })
  @IsDateString()
  entryDate: string;

  @ApiPropertyOptional({ description: 'Mode of transport', example: 'OCEAN' })
  @IsOptional()
  @IsString()
  modeOfTransport?: string;
}

export class ValidateExternalProviderFormulaDto {
  @ApiProperty({ description: 'External provider code', example: 'FLEXPORT' })
  @IsString()
  provider: string;

  @ApiProperty({ description: 'HTS number', example: '4820.10.20.10' })
  @IsString()
  htsNumber: string;

  @ApiProperty({ description: 'ISO country code', example: 'CN' })
  @IsString()
  countryCode: string;

  @ApiProperty({ description: 'Entry date', example: '2026-02-15' })
  @IsDateString()
  entryDate: string;

  @ApiPropertyOptional({ description: 'Mode of transport', example: 'OCEAN', default: 'OCEAN' })
  @IsOptional()
  @IsString()
  modeOfTransport?: string;

  @ApiPropertyOptional({ description: 'Shipment customs value', example: 10000 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  value?: number;

  @ApiPropertyOptional({ description: 'Product name hint for provider UI', example: 'diaries-and-address-books' })
  @IsOptional()
  @IsString()
  productName?: string;

  @ApiPropertyOptional({
    description: 'Provider context payload (chapter99 selections, SPI selections, loading date, etc.)',
    example: {
      chapter99Selections: { '9903.88.15': true },
      spiSelections: {},
      dateOfLoading: '2026-02-15',
    },
  })
  @IsOptional()
  @IsObject()
  inputContext?: Record<string, any>;

  @ApiPropertyOptional({
    description: 'When true, use mock provider extraction instead of live browser scraping',
    default: false,
  })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  useMock?: boolean = false;

  @ApiPropertyOptional({
    description:
      'When true, validation fails if provider formula cannot be extracted from live provider response',
    default: true,
  })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  requireFormulaExtraction?: boolean = true;

  @ApiPropertyOptional({
    description:
      'When true, allows AI-assisted formula extraction fallback when direct provider parsing cannot find a formula',
    default: true,
  })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  useAiExtraction?: boolean = true;

  @ApiPropertyOptional({
    description:
      'When true, automatically trigger discrepancy analysis after validation when formulas do not match',
    default: true,
  })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  autoAnalyzeOnMismatch?: boolean = true;

  @ApiPropertyOptional({
    description: 'When true, any changed provider snapshot becomes latest',
    default: true,
  })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  upsertLatest?: boolean = true;
}

export class AnalyzeExternalProviderDiscrepancyDto {
  @ApiProperty({ description: 'External provider code', example: 'FLEXPORT' })
  @IsString()
  provider: string;

  @ApiProperty({ description: 'HTS number', example: '4820.10.20.10' })
  @IsString()
  htsNumber: string;

  @ApiProperty({ description: 'ISO country code', example: 'CN' })
  @IsString()
  countryCode: string;

  @ApiProperty({ description: 'Entry date', example: '2026-02-15' })
  @IsDateString()
  entryDate: string;

  @ApiPropertyOptional({ description: 'Mode of transport', example: 'OCEAN' })
  @IsOptional()
  @IsString()
  modeOfTransport?: string;
}

export class ManualReviewExternalProviderFormulaDto {
  @ApiProperty({ description: 'External provider code', example: 'FLEXPORT' })
  @IsString()
  provider: string;

  @ApiProperty({ description: 'HTS number', example: '4820.10.20.10' })
  @IsString()
  htsNumber: string;

  @ApiProperty({ description: 'ISO country code', example: 'CN' })
  @IsString()
  countryCode: string;

  @ApiProperty({ description: 'Entry date', example: '2026-02-15' })
  @IsDateString()
  entryDate: string;

  @ApiPropertyOptional({ description: 'Mode of transport', example: 'OCEAN', default: 'OCEAN' })
  @IsOptional()
  @IsString()
  modeOfTransport?: string;

  @ApiPropertyOptional({ description: 'Provider context payload', example: { value: 10000 } })
  @IsOptional()
  @IsObject()
  inputContext?: Record<string, any>;

  @ApiProperty({
    description: 'Formula text manually discovered by admin from provider UI',
    example: 'The duty provided in the applicable subheading + 25%',
  })
  @IsString()
  manualFormulaRaw: string;

  @ApiPropertyOptional({
    description: 'Optional normalized formula; if omitted, service normalizes manualFormulaRaw',
    example: 'THE DUTY PROVIDED IN THE APPLICABLE SUBHEADING + 25%',
  })
  @IsOptional()
  @IsString()
  manualFormulaNormalized?: string;

  @ApiProperty({ description: 'Provider source URL', example: 'https://tariffs.flexport.com/?...' })
  @IsString()
  sourceUrl: string;

  @ApiPropertyOptional({
    description: 'Manual evidence: snippets, screenshots, notes, and reasoning',
    example: {
      copiedText: 'The duty provided in the applicable subheading + 25%',
      screenshotPath: '/tmp/flexport-4820-cn.png',
      reviewerNotes: 'Captured after selecting 9903.01.25',
    },
  })
  @IsOptional()
  @IsObject()
  evidence?: Record<string, any>;

  @ApiPropertyOptional({
    description: 'When true, service automatically runs discrepancy analysis after compare',
    default: true,
  })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  autoAnalyze?: boolean = true;
}

export class ReviewExternalProviderFormulaDto {
  @ApiProperty({
    description: 'Review decision',
    enum: ['APPROVED', 'REJECTED'],
  })
  @IsIn(['APPROVED', 'REJECTED'])
  decision: 'APPROVED' | 'REJECTED';

  @ApiPropertyOptional({ description: 'Review comment' })
  @IsOptional()
  @IsString()
  comment?: string;
}

export class PublishExternalProviderFormulaDto {
  @ApiPropertyOptional({
    description: 'Formula type to publish',
    enum: ['GENERAL', 'OTHER', 'ADJUSTED', 'OTHER_CHAPTER99'],
  })
  @IsOptional()
  @IsIn(['GENERAL', 'OTHER', 'ADJUSTED', 'OTHER_CHAPTER99'])
  formulaType?: string;

  @ApiPropertyOptional({
    description: 'Target version for override record. Defaults to active HTS sourceVersion.',
    example: '2026_revision_1',
  })
  @IsOptional()
  @IsString()
  updateVersion?: string;

  @ApiPropertyOptional({ description: 'Carry this override forward to future versions', default: true })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  carryover?: boolean = true;

  @ApiPropertyOptional({ description: 'Override extra taxes when this formula is used', default: false })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  overrideExtraTax?: boolean = false;

  @ApiPropertyOptional({ description: 'Publish comment' })
  @IsOptional()
  @IsString()
  comment?: string;
}

export class ReanalyzeExternalProviderFormulaDto {
  @ApiProperty({ description: 'Snapshot id' })
  @IsUUID()
  snapshotId: string;
}
