import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

/**
 * HTS Stage Entry Entity - Staged HTS entries for preprocessing/validation
 */
@Entity('hts_stage_entries')
@Index(['importId', 'htsNumber'], { unique: true })
@Index(['importId'])
@Index(['htsNumber'])
@Index(['sourceVersion'])
export class HtsStageEntryEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /**
   * Import ID - References hts_import_history.id
   */
  @Column('uuid')
  importId: string;

  /**
   * Source Version - USITC data version
   */
  @Column('varchar', { length: 50 })
  sourceVersion: string;

  /**
   * HTS Number - Full classification code
   */
  @Column('varchar', { length: 20 })
  htsNumber: string;

  /**
   * Indent level - Hierarchy depth
   */
  @Column('integer', { default: 0 })
  indent: number;

  /**
   * Description - Product description
   */
  @Column('text')
  description: string;

  /**
   * Unit (raw) - Stored to align with 1243 schema
   */
  @Column('varchar', { length: 50, nullable: true })
  unit: string | null;

  /**
   * General Rate (raw)
   */
  @Column('text', { nullable: true })
  generalRate: string | null;

  /**
   * Special Rate (raw)
   */
  @Column('text', { nullable: true })
  special: string | null;

  /**
   * Other Rate (raw)
   */
  @Column('text', { nullable: true })
  other: string | null;

  /**
   * Chapter 99 Adjusted Rate (raw)
   */
  @Column('text', { nullable: true })
  chapter99: string | null;

  /**
   * Chapter - 2-digit chapter number
   */
  @Column('varchar', { length: 2 })
  chapter: string;

  /**
   * Heading - 4-digit heading
   */
  @Column('varchar', { length: 4, nullable: true })
  heading: string | null;

  /**
   * Subheading - 6-digit subheading
   */
  @Column('varchar', { length: 6, nullable: true })
  subheading: string | null;

  /**
   * Statistical Suffix - 8 or 10 digit code
   */
  @Column('varchar', { length: 10, nullable: true })
  statisticalSuffix: string | null;

  /**
   * Parent HTS Number - Reference to parent in hierarchy
   */
  @Column('varchar', { length: 20, nullable: true })
  parentHtsNumber: string | null;

  /**
   * Row Hash - Deterministic hash for comparison
   */
  @Column('varchar', { length: 64 })
  rowHash: string;

  /**
   * Raw Item - Original USITC JSON item
   */
  @Column('jsonb', { nullable: true })
  rawItem: Record<string, any> | null;

  /**
   * Normalized Payload - Preprocessed fields for validation
   */
  @Column('jsonb', { nullable: true })
  normalized: Record<string, any> | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
