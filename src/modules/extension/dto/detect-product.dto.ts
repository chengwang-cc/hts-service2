import {
  IsString,
  IsOptional,
  IsObject,
  IsArray,
  ValidateNested,
  ArrayMinSize,
  ArrayMaxSize,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * DTO for LLM-assisted product detection
 */
export class DetectProductDto {
  @IsObject()
  metadata: {
    url: string;
    title: string;
    pageType: string;
  };

  @IsArray()
  @ArrayMinSize(1, { message: 'At least one product text is required' })
  @ArrayMaxSize(50, { message: 'Maximum 50 product texts allowed' })
  @IsString({ each: true })
  productTexts: string[];

  @IsString()
  @IsOptional()
  @MaxLength(2000, { message: 'Truncated content must not exceed 2000 characters' })
  truncatedContent?: string;

  @IsObject()
  @IsOptional()
  heuristicHints?: any;
}

/**
 * DTO for bulk product classification
 */
export class BulkClassifyDto {
  @IsArray()
  @ArrayMinSize(1, { message: 'At least one product is required for classification' })
  @ArrayMaxSize(20, { message: 'Maximum 20 products per request' })
  @ValidateNested({ each: true })
  @Type(() => ProductForClassification)
  products: ProductForClassification[];

  @IsString()
  @IsOptional()
  @MaxLength(255, { message: 'Organization ID must not exceed 255 characters' })
  organizationId?: string;
}

export class ProductForClassification {
  @IsString()
  @MaxLength(500, { message: 'Product name must not exceed 500 characters' })
  name: string;

  @IsString()
  @IsOptional()
  @MaxLength(2000, { message: 'Product description must not exceed 2000 characters' })
  description?: string;

  @IsString()
  @IsOptional()
  @MaxLength(200, { message: 'Category must not exceed 200 characters' })
  category?: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  @ArrayMaxSize(10, { message: 'Maximum 10 materials allowed' })
  materials?: string[];

  @IsArray()
  @IsOptional()
  @ArrayMaxSize(5, { message: 'Maximum 5 images allowed' })
  images?: Array<{ url: string }>;

  @IsString()
  @IsOptional()
  @MaxLength(200, { message: 'Brand must not exceed 200 characters' })
  brand?: string;
}

/**
 * DTO for user feedback
 */
export class FeedbackDto {
  @IsString()
  @MaxLength(255, { message: 'Product ID must not exceed 255 characters' })
  productId: string;

  @IsString()
  @MaxLength(100, { message: 'Field name must not exceed 100 characters' })
  field: string;

  @IsOptional()
  originalValue?: any;

  @IsOptional()
  correctedValue?: any;

  @IsString()
  @IsOptional()
  @MaxLength(5000, { message: 'User comment must not exceed 5000 characters' })
  userComment?: string;

  @IsString()
  @IsOptional()
  @MaxLength(500, { message: 'User agent must not exceed 500 characters' })
  userAgent?: string;

  @IsString()
  @IsOptional()
  @MaxLength(1000, { message: 'Page URL must not exceed 1000 characters' })
  pageUrl?: string;

  @IsString()
  @IsOptional()
  @MaxLength(255, { message: 'User ID must not exceed 255 characters' })
  userId?: string;
}
