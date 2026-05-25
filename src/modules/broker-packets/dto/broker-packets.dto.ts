import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBase64,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class UploadDocumentDto {
  @IsString()
  @Length(1, 255)
  fileName: string;

  @IsString()
  @Length(1, 120)
  mimeType: string;

  @IsBase64()
  contentBase64: string;

  @IsOptional()
  @IsString()
  @Length(0, 60)
  documentType?: string;
}

export class CreatePacketDto {
  @IsUUID('4')
  clientId: string;

  @IsOptional()
  @IsUUID('4')
  shipmentId?: string | null;

  @IsOptional()
  @IsString()
  @Length(0, 200)
  label?: string | null;

  @IsOptional()
  @IsIn(['broker', 'client_portal', 'email_ingest', 'api'])
  source?: 'broker' | 'client_portal' | 'email_ingest' | 'api';

  @IsArray()
  @ArrayMaxSize(40)
  @ValidateNested({ each: true })
  @Type(() => UploadDocumentDto)
  documents: UploadDocumentDto[];

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown> | null;
}

export class ClientPortalUploadDto {
  @IsUUID('4')
  relationshipId: string;

  @IsOptional()
  @IsString()
  @Length(0, 200)
  label?: string | null;

  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => UploadDocumentDto)
  documents: UploadDocumentDto[];
}

export class ListPacketsDto {
  @IsOptional()
  @IsUUID('4')
  clientId?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(0)
  offset?: number;
}

export class ReviewFieldDto {
  @IsIn(['accepted', 'overridden', 'rejected', 'suggested'])
  status: 'accepted' | 'overridden' | 'rejected' | 'suggested';

  @IsOptional()
  @IsString()
  value?: string | null;
}

export class DraftEntryFromPacketDto {
  @IsUUID('4')
  packetId: string;

  @IsOptional()
  @IsUUID('4')
  shipmentId?: string | null;

  @IsOptional()
  @IsIn([
    'consumption',
    'informal',
    'warehouse',
    'fta',
    'tib',
    'in_bond',
    'isf',
    'other',
  ])
  entryType?:
    | 'consumption'
    | 'informal'
    | 'warehouse'
    | 'fta'
    | 'tib'
    | 'in_bond'
    | 'isf'
    | 'other';
}
