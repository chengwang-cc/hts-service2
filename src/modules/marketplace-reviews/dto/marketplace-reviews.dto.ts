import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
} from 'class-validator';

export class CreateReviewDto {
  @IsUUID('4')
  requestId: string;

  @IsInt()
  @Min(1)
  @Max(5)
  rating: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  tags?: string[];

  @IsOptional()
  @IsString()
  @Length(0, 5000)
  comment?: string;
}

export class ModerateReviewDto {
  @IsIn(['approved', 'hidden', 'rejected'])
  status: 'approved' | 'hidden' | 'rejected';

  @IsOptional()
  @IsString()
  @Length(0, 2000)
  note?: string;
}

export class GrantCreditsDto {
  @IsUUID('4')
  organizationId: string;

  @IsIn(['lead', 'concierge'])
  creditType: 'lead' | 'concierge';

  @IsInt()
  @Min(1)
  @Max(10000)
  amount: number;

  @IsString()
  @Length(2, 80)
  eventType: string;

  @IsOptional()
  @IsString()
  description?: string;
}

export class ConsumeCreditsDto {
  @IsIn(['lead', 'concierge'])
  creditType: 'lead' | 'concierge';

  @IsInt()
  @Min(1)
  @Max(1000)
  amount: number;

  @IsString()
  @Length(2, 80)
  eventType: string;

  @IsOptional()
  @IsString()
  description?: string;
}

export class ListReviewsDto {
  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(0)
  offset?: number;

  @IsOptional()
  @IsIn(['pending', 'approved', 'hidden', 'rejected'])
  moderationStatus?: 'pending' | 'approved' | 'hidden' | 'rejected';
}
