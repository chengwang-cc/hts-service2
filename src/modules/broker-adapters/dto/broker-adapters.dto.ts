import { IsBoolean, IsIn, IsObject, IsOptional, IsString, IsUUID, Length } from 'class-validator';

const adapterTypes = [
  'generic_csv',
  'json_webhook',
  'magaya_acelynk',
  'descartes',
  'cargowise',
  'catair_edi',
] as const;

export class CreateAdapterDto {
  @IsIn(adapterTypes)
  adapterType: (typeof adapterTypes)[number];

  @IsString()
  @Length(2, 200)
  label: string;

  @IsOptional()
  @IsObject()
  publicConfig?: Record<string, unknown> | null;

  @IsOptional()
  @IsObject()
  secrets?: Record<string, string> | null;

  @IsOptional()
  @IsObject()
  fieldMappingProfile?: Record<string, string> | null;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class UpdateAdapterDto {
  @IsOptional()
  @IsString()
  @Length(2, 200)
  label?: string;

  @IsOptional()
  @IsObject()
  publicConfig?: Record<string, unknown> | null;

  @IsOptional()
  @IsObject()
  secrets?: Record<string, string> | null;

  @IsOptional()
  @IsObject()
  fieldMappingProfile?: Record<string, string> | null;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class CreateExportJobDto {
  @IsUUID('4')
  entryId: string;

  @IsUUID('4')
  adapterId: string;
}

export class ImportStatusMessageDto {
  @IsUUID('4')
  entryId: string;

  @IsString()
  @Length(1, 60)
  source: string;

  @IsString()
  @Length(1, 80)
  messageType: string;

  @IsOptional()
  @IsString()
  normalizedStatus?: string;

  @IsOptional()
  @IsIn(['info', 'warning', 'error', 'success'])
  severity?: 'info' | 'warning' | 'error' | 'success';

  @IsObject()
  rawMessage: Record<string, unknown>;
}
