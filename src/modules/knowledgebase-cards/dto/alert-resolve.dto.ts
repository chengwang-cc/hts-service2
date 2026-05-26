import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';

export class AlertResolveDto {
  @ApiProperty({ enum: ['dismissed', 'actioned'] })
  @IsEnum(['dismissed', 'actioned'])
  status: 'dismissed' | 'actioned';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;

  @ApiPropertyOptional({ example: 'https://github.com/org/repo/pull/123' })
  @IsOptional()
  @IsUrl()
  prUrl?: string;
}
