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

@Entity('hts_note_rates')
@Index(['noteId'])
export class HtsNoteRateEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  noteId: string;

  @Column('text')
  rateText: string;

  @Column('text', { nullable: true })
  formula: string | null;

  @Column('varchar', { length: 50 })
  rateType: string;

  @Column('jsonb', { nullable: true })
  variables:
    | Array<{
        name: string;
        type: string;
        unit?: string;
        description?: string;
      }>
    | null;

  @Column('decimal', { precision: 5, scale: 2, nullable: true })
  confidence: number | null;

  @Column('boolean', { default: false })
  verified: boolean;

  @Column('jsonb', { nullable: true })
  metadata: Record<string, any> | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @ManyToOne(() => HtsNoteEntity, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'note_id' })
  note?: HtsNoteEntity;
}
