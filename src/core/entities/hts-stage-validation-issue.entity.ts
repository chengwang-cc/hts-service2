import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

/**
 * HTS Stage Validation Issue - Validation errors/warnings for staged entries
 */
@Entity('hts_stage_validation_issues')
@Index(['importId'])
@Index(['stageEntryId'])
@Index(['severity'])
export class HtsStageValidationIssueEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /**
   * Import ID - References hts_import_history.id
   */
  @Column('uuid')
  importId: string;

  /**
   * Stage Entry ID - References hts_stage_entries.id
   */
  @Column('uuid', { nullable: true })
  stageEntryId: string | null;

  /**
   * HTS Number - Staged HTS code for context
   */
  @Column('varchar', { length: 20, nullable: true })
  htsNumber: string | null;

  /**
   * Issue Code - Machine-readable code
   */
  @Column('varchar', { length: 50 })
  issueCode: string;

  /**
   * Severity - ERROR | WARNING | INFO
   */
  @Column('varchar', { length: 20, default: 'ERROR' })
  severity: string;

  /**
   * Message - Human-readable message
   */
  @Column('text')
  message: string;

  /**
   * Details - Additional metadata for debugging
   */
  @Column('jsonb', { nullable: true })
  details: Record<string, any> | null;

  @CreateDateColumn()
  createdAt: Date;
}
