import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';

export class IngestUrlDto {
  @ApiProperty({ example: 'https://www.cbp.gov/csms/55424218' })
  @IsUrl()
  url: string;

  @ApiPropertyOptional({ example: 'cbp.csms.55424218' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  suggestedCardKey?: string;

  @ApiPropertyOptional({ example: 'csms' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  documentType?: string;

  @ApiPropertyOptional({ example: 'US' })
  @IsOptional()
  @IsString()
  @MaxLength(8)
  jurisdiction?: string;
}
