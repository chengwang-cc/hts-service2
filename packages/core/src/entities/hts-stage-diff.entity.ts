import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

/**
 * HTS Stage Diff - Side-by-side comparison results
 */
@Entity('hts_stage_diffs')
@Index(['importId'])
@Index(['stageEntryId'])
@Index(['diffType'])
export class HtsStageDiffEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /**
   * Import ID - References hts_import_history.id
   */
  @Column('uuid')
  importId: string;

  /**
   * Stage Entry ID - References hts_stage_entries.id (null for removed entries)
   */
  @Column('uuid', { nullable: true })
  stageEntryId: string | null;

  /**
   * Current HTS ID - References hts.id (null for new entries)
   */
  @Column('uuid', { nullable: true })
  currentHtsId: string | null;

  /**
   * HTS Number - Comparison key
   */
  @Column('varchar', { length: 20 })
  htsNumber: string;

  /**
   * Diff Type - ADDED | REMOVED | CHANGED | UNCHANGED
   */
  @Column('varchar', { length: 20 })
  diffType: string;

  /**
   * Diff Summary - JSON diff details per field
   */
  @Column('jsonb', { nullable: true })
  diffSummary: Record<string, any> | null;

  @CreateDateColumn()
  createdAt: Date;
}
