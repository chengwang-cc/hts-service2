import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  ValidateNested,
} from 'class-validator';

export class CreateMissingInfoTaskDto {
  @IsUUID('4')
  relationshipId: string;

  @IsOptional()
  @IsUUID('4')
  entryId?: string | null;

  @IsOptional()
  @IsUUID('4')
  lineId?: string | null;

  @IsOptional()
  @IsUUID('4')
  fieldExtractedId?: string | null;

  @IsOptional()
  @IsString()
  @Length(0, 80)
  fieldPath?: string | null;

  @IsString()
  @Length(2, 220)
  prompt: string;

  @IsOptional()
  @IsString()
  @Length(0, 4000)
  detail?: string;

  @IsOptional()
  @IsIn(['info', 'warning', 'blocker'])
  severity?: 'info' | 'warning' | 'blocker';

  @IsOptional()
  @Transform(({ value }) => (value ? new Date(value) : null))
  dueAt?: Date | null;
}

export class AttachmentDto {
  @IsString()
  storageKey: string;

  @IsString()
  fileName: string;

  @IsString()
  mimeType: string;

  @Transform(({ value }) => Number(value))
  byteSize: number;
}

export class AnswerTaskDto {
  @IsString()
  @Length(1, 8000)
  answer: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => AttachmentDto)
  attachments?: AttachmentDto[];
}
