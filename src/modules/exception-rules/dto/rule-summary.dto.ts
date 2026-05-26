import { ApiProperty } from '@nestjs/swagger';
import type { ProgramFamily } from '../types';

/**
 * Public summary returned by `GET /admin/exception-rules`.
 *
 * Mirrors `ExceptionRuleSummary` from `types.ts` but is a class so it can
 * carry `@ApiProperty` decorators for the OpenAPI snapshot.
 */
export class RuleSummaryDto {
  @ApiProperty({ example: 'us.section232.aluminum-smelt-cast' })
  id: string;

  @ApiProperty({ example: 'US' })
  destination: string;

  @ApiProperty({ example: 'section_232' })
  authority: ProgramFamily;

  @ApiProperty({ example: 'Section 232 Aluminum — Country of Smelt & Cast' })
  title: string;

  @ApiProperty({ example: 2200 })
  priority: number;

  @ApiProperty({ example: true })
  enabled: boolean;

  @ApiProperty({
    type: [String],
    example: ['cbp.csms.55424218', 'fr.proclamation.10895'],
  })
  knowledgeCardKeys: string[];

  @ApiProperty({ type: [String], example: [] })
  conflictsWith: string[];

  @ApiProperty({ nullable: true, example: null })
  effectiveFrom: string | null;

  @ApiProperty({ nullable: true, example: null })
  effectiveTo: string | null;

  @ApiProperty({ nullable: true, example: null })
  statusReason: string | null;
}
