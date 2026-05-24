import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsOptional,
  IsString,
  Length,
} from 'class-validator';
import { CalculatePublicDto } from '../../v1/dto/calculate-public.dto';
import { TariffSelectionMode } from '../../../calculator/dto/calculate.dto';

/**
 * CalculatePublicV2Dto
 *
 * Forward-compatible extension of v1's `CalculatePublicDto`. Anything a v1
 * client could send is valid v2 input, plus:
 *
 *   - destinationCountry  — ISO-3166-1 alpha-2. Defaults to 'US' when
 *                            omitted (US-only is back-compat with v1).
 *   - destinationRegion   — sub-national region (US state, CA province).
 *   - tariffSelectionMode — when caller supplies only a 6-digit HS, pick
 *                            'preferred' | 'maximum' | 'median' | 'minimum'.
 */
export class CalculatePublicV2Dto extends CalculatePublicDto {
  @ApiPropertyOptional({
    description:
      'Destination jurisdiction (ISO 3166-1 alpha-2). Defaults to "US" when omitted. Supported: US, GB, HK, CA, EU+memberState, plus EU member-state shorthand (DE, FR, …).',
    example: 'US',
  })
  @IsOptional()
  @IsString()
  @Length(2, 2)
  destinationCountry?: string;

  @ApiPropertyOptional({
    description:
      'EU member state when destinationCountry="EU" (e.g. "DE"). Ignored otherwise.',
    example: 'DE',
  })
  @IsOptional()
  @IsString()
  @Length(2, 2)
  destinationMemberState?: string;

  @ApiPropertyOptional({
    description: 'Sub-national region (US state, CA province).',
    example: 'ON',
  })
  @IsOptional()
  @IsString()
  destinationRegion?: string;

  @ApiPropertyOptional({
    enum: ['preferred', 'maximum', 'median', 'minimum'],
    description:
      'How to pick a deep code when only a 6-digit HS is supplied. Ignored for fully-specified HTS codes.',
  })
  @IsOptional()
  @IsEnum(['preferred', 'maximum', 'median', 'minimum'])
  tariffSelectionMode?: TariffSelectionMode;
}
