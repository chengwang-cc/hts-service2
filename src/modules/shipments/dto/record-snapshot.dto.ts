import { IsNumber, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

export class RecordSnapshotDto {
  @IsObject()
  quoteRequest: Record<string, unknown>;

  @IsObject()
  quoteResponse: Record<string, unknown>;

  @IsOptional()
  @IsNumber()
  payable?: number;

  @IsOptional()
  @IsString()
  @MaxLength(8)
  currency?: string;
}
