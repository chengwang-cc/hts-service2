import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';

export class RefreshReciprocalTariffDto {
  @ApiPropertyOptional({
    description: 'Dry-run mode (no DB writes)',
    default: false,
  })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  dryRun?: boolean = false;

  @ApiPropertyOptional({
    description: 'Deactivate older reciprocal tariff records before upsert',
    default: true,
  })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  deactivatePrevious?: boolean = true;

  @ApiPropertyOptional({
    description:
      'Use OpenAI web-search-backed extraction over official .gov sources as supplemental signal',
    default: true,
  })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  useAiDeepSearch?: boolean = true;
}

