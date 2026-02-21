import { IsString } from 'class-validator';

export class ResolveNoteDto {
  @IsString()
  htsNumber: string;

  @IsString()
  noteReference: string;
}
