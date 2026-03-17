import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  Max,
  Min,
} from 'class-validator';

function toInt(defaultValue: number) {
  return Transform(({ value }) => {
    if (value === undefined || value === null || value === '') {
      return defaultValue;
    }
    const parsed = Number.parseInt(String(value), 10);
    return Number.isFinite(parsed) ? parsed : defaultValue;
  });
}

function toBool(defaultValue: boolean) {
  return Transform(({ value }) => {
    if (value === undefined || value === null || value === '') {
      return defaultValue;
    }
    if (typeof value === 'boolean') {
      return value;
    }
    const normalized = String(value).trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) {
      return true;
    }
    if (['0', 'false', 'no', 'off'].includes(normalized)) {
      return false;
    }
    return defaultValue;
  });
}

export class LookupDatasetCurationJobDto {
  @IsOptional()
  @toInt(3)
  @IsInt()
  @Min(1)
  @Max(10)
  maxPerCode?: number = 3;

  @IsOptional()
  @toInt(300)
  @IsInt()
  @Min(25)
  @Max(2000)
  auditSubsetSize?: number = 300;

  @IsOptional()
  @toInt(10)
  @IsInt()
  @Min(3)
  @Max(25)
  probeLimit?: number = 10;

  @IsOptional()
  @toInt(15000)
  @IsInt()
  @Min(1000)
  @Max(60000)
  probeTimeoutMs?: number = 15000;

  @IsOptional()
  @toInt(6)
  @IsInt()
  @Min(1)
  @Max(20)
  concurrency?: number = 6;

  @IsOptional()
  @toBool(true)
  @IsBoolean()
  aiAssist?: boolean = true;

  @IsOptional()
  @Transform(({ value }) => {
    if (value === undefined || value === null || value === '') {
      return 'audit-only';
    }
    return String(value).trim().toLowerCase();
  })
  @IsIn(['none', 'audit-only'])
  aiMode?: 'none' | 'audit-only' = 'audit-only';
}
