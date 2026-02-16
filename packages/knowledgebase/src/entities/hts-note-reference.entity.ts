import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { HtsNoteEntity } from './hts-note.entity';

@Entity('hts_note_references')
@Index(['htsNumber', 'noteId'])
@Index(['htsNumber', 'year'])
@Index(['htsNumber', 'noteId', 'sourceColumn', 'year'])
export class HtsNoteReferenceEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('varchar', { length: 20 })
  htsNumber: string;

  @Column('uuid')
  noteId: string;

  @Column('text')
  referenceText: string;

  @Column('varchar', { length: 20 })
  sourceColumn: string;

  @Column('int')
  year: number;

  @Column('boolean', { default: true })
  active: boolean;

  @Column('varchar', { length: 50, nullable: true })
  resolutionMethod: string | null;

  @Column('decimal', { precision: 5, scale: 2, nullable: true })
  confidence: number | null;

  @Column('text', { nullable: true })
  resolvedFormula: string | null;

  @Column('boolean', { default: false })
  isResolved: boolean;

  @Column('jsonb', { nullable: true })
  resolutionMetadata: Record<string, any> | null;

  @Column('timestamp', { nullable: true })
  resolvedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @ManyToOne(() => HtsNoteEntity, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'note_id' })
  note?: HtsNoteEntity;
}
