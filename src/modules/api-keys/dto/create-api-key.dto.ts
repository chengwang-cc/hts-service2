import {
  IsString,
  IsEnum,
  IsArray,
  IsOptional,
  IsInt,
  Min,
  IsISO8601,
  MaxLength,
} from 'class-validator';

export class CreateApiKeyDto {
  @IsString()
  @MaxLength(255)
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsEnum(['test', 'live'])
  environment: 'test' | 'live';

  @IsArray()
  @IsString({ each: true })
  permissions: string[];

  @IsOptional()
  @IsInt()
  @Min(1)
  rateLimitPerMinute?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  rateLimitPerDay?: number;

  @IsOptional()
  @IsISO8601()
  expiresAt?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  ipWhitelist?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  allowedOrigins?: string[];
}
