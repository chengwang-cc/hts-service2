import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class CreateMarketplaceRequestDto {
  @IsOptional()
  @IsString()
  @Length(0, 200)
  title?: string | null;

  @IsString()
  @Length(2, 5000)
  commoditySummary: string;

  @IsOptional()
  @IsString()
  @Length(0, 10)
  originCountry?: string | null;

  @IsOptional()
  @IsString()
  @Length(0, 10)
  destinationCountry?: string | null;

  @IsOptional()
  @IsString()
  @Length(0, 40)
  portOfEntry?: string | null;

  @IsOptional()
  @IsIn(['ocean', 'air', 'truck', 'rail', 'parcel', 'multimodal'])
  mode?: 'ocean' | 'air' | 'truck' | 'rail' | 'parcel' | 'multimodal';

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(40)
  serviceCategories?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(40)
  candidateHtsNumbers?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(40)
  regulatoryFlags?: string[];

  @IsOptional()
  @IsNumber()
  @Min(0)
  shipmentValue?: number | null;

  @IsOptional()
  @IsString()
  @Length(0, 10)
  shipmentCurrency?: string | null;

  @IsOptional()
  @IsString()
  @Length(0, 60)
  shipmentVolume?: string | null;

  @IsOptional()
  @IsIn(['invited', 'public', 'private'])
  visibilityMode?: 'invited' | 'public' | 'private';

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsUUID('4', { each: true })
  invitedBrokerProfileIds?: string[];

  @IsOptional()
  @IsIn(['one_time', 'ongoing', 'project'])
  requestType?: 'one_time' | 'ongoing' | 'project';

  @IsOptional()
  @Transform(({ value }) => (value ? new Date(value) : null))
  deadline?: Date | null;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown> | null;
}

export class ListMarketplaceRequestsDto {
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

export class InviteBrokersDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(20)
  @IsUUID('4', { each: true })
  brokerProfileIds: string[];
}

export class DeclineLeadDto {
  @IsOptional()
  @IsString()
  @Length(0, 2000)
  reason?: string;
}

export class QuoteFeeLineDto {
  @IsString()
  @Length(1, 120)
  label: string;

  @IsNumber()
  @Min(0)
  amount: number;

  @IsString()
  @Length(3, 10)
  currency: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class CreateQuoteDto {
  @IsOptional()
  @IsString()
  serviceScope?: string;

  @IsOptional()
  @IsIn(['flat', 'per_entry', 'per_line', 'tiered', 'custom'])
  feeModel?: 'flat' | 'per_entry' | 'per_line' | 'tiered' | 'custom';

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => QuoteFeeLineDto)
  feeBreakdown?: QuoteFeeLineDto[];

  @IsOptional()
  @IsNumber()
  @Min(0)
  estimatedTotal?: number;

  @IsOptional()
  @IsString()
  @Length(3, 10)
  currency?: string;

  @IsOptional()
  @IsString()
  estimatedTimeline?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(40)
  requiredDocuments?: string[];

  @IsOptional()
  @IsString()
  brokerNotes?: string;

  @IsOptional()
  @IsString()
  brokerQuestions?: string;

  @IsOptional()
  @Transform(({ value }) => (value ? new Date(value) : null))
  expiresAt?: Date | null;
}

export class SendMessageDto {
  @IsString()
  @Length(1, 8000)
  body: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  attachments?: Array<{
    storageKey: string;
    fileName: string;
    mimeType: string;
    byteSize: number;
  }>;
}

export class ConsentToFullPacketDto {
  @IsBoolean()
  consent: boolean;
}

export class AcceptQuoteDto {
  @IsOptional()
  @IsString()
  note?: string;

  @IsOptional()
  @IsString()
  @Length(1, 120)
  idempotencyKey?: string;
}
