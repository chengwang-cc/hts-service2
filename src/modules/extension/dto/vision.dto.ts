import {
  IsString,
  IsOptional,
  MaxLength,
  IsObject,
  IsUrl,
  IsEnum,
  IsBoolean,
  IsNumber,
  Min,
  Max,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * DTO for detecting products from uploaded image
 * POST /api/v1/extension/detect-from-image
 */
export class DetectFromImageDto {
  @ApiPropertyOptional({
    description: 'Original page URL where image was found (for context)',
    example: 'https://example.com/product/12345',
    maxLength: 1000,
  })
  @IsString()
  @IsOptional()
  @MaxLength(1000)
  sourceUrl?: string;

  @ApiPropertyOptional({
    description: 'Page title (for context)',
    example: 'Premium Leather Wallet - Black',
    maxLength: 500,
  })
  @IsString()
  @IsOptional()
  @MaxLength(500)
  pageTitle?: string;

  @ApiPropertyOptional({
    description: 'Additional metadata',
    example: { userAgent: 'Chrome/...' },
  })
  @IsObject()
  @IsOptional()
  metadata?: {
    userAgent?: string;
    referrer?: string;
  };
}

/**
 * Scraping options for URL detection
 */
export class ScrapingOptionsDto {
  @ApiPropertyOptional({
    description: 'CSS selector to wait for before considering page loaded',
    example: '.product-container',
    maxLength: 200,
  })
  @IsString()
  @IsOptional()
  @MaxLength(200)
  waitForSelector?: string;

  @ApiPropertyOptional({
    description: 'Timeout in milliseconds for page load',
    example: 30000,
    minimum: 1000,
    maximum: 60000,
  })
  @IsNumber()
  @IsOptional()
  @Min(1000)
  @Max(60000)
  timeout?: number;
}

/**
 * DTO for detecting products from URL
 * POST /api/v1/extension/detect-from-url
 */
export class DetectFromUrlDto {
  @ApiProperty({
    description: 'URL of the webpage to scrape',
    example: 'https://example.com/product/12345',
    maxLength: 2000,
  })
  @IsUrl({
    require_protocol: true,
    protocols: ['http', 'https'],
  })
  @MaxLength(2000)
  url: string;

  @ApiPropertyOptional({
    description:
      'When to use Puppeteer: auto (decide based on content), force (always use), never (HTTP only)',
    enum: ['auto', 'force', 'never'],
    default: 'auto',
  })
  @IsEnum(['auto', 'force', 'never'])
  @IsOptional()
  usePuppeteer?: 'auto' | 'force' | 'never' = 'auto';

  @ApiPropertyOptional({
    description:
      'Enable vision analysis (capture screenshot and analyze with GPT-4o vision)',
    default: false,
  })
  @IsBoolean()
  @IsOptional()
  enableVision?: boolean = false;

  @ApiPropertyOptional({
    description: 'Options for Puppeteer scraping',
    type: ScrapingOptionsDto,
  })
  @IsObject()
  @IsOptional()
  @ValidateNested()
  @Type(() => ScrapingOptionsDto)
  scrapingOptions?: ScrapingOptionsDto;
}
