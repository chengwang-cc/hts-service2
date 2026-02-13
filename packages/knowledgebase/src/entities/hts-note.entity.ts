import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
  OneToMany,
  OneToOne,
} from 'typeorm';
import { HtsDocumentEntity } from './hts-document.entity';
import { HtsNoteEmbeddingEntity } from './hts-note-embedding.entity';
import { HtsNoteRateEntity } from './hts-note-rate.entity';
import { HtsNoteReferenceEntity } from './hts-note-reference.entity';

@Entity('hts_notes')
@Index(['noteType', 'chapter', 'noteNumber'])
@Index(['year', 'noteType'])
export class HtsNoteEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid', { name: 'document_id' })
  documentId: string;

  @Column('varchar', { length: 3 })
  chapter: string;

  @Column('varchar', { length: 50, name: 'type', default: 'ADDITIONAL_US_NOTE' })
  noteType: string;

  @Column('varchar', { length: 20 })
  noteNumber: string;

  @Column('text', { nullable: true })
  title: string | null;

  @Column('text')
  content: string;

  @Column('text', { nullable: true })
  scope: string | null;

  @Column('int')
  year: number;

  @Column('boolean', { default: false, name: 'has_rate' })
  hasRate: boolean;

  @Column('jsonb', { nullable: true })
  extractedData: Record<string, any> | null;

  @Column('decimal', { precision: 5, scale: 2, nullable: true })
  confidence: number | null;

  @Column('jsonb', { nullable: true })
  metadata: Record<string, any> | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @ManyToOne(() => HtsDocumentEntity, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'document_id' })
  document?: HtsDocumentEntity;

  @OneToOne(() => HtsNoteEmbeddingEntity, (embedding) => embedding.note)
  embedding?: HtsNoteEmbeddingEntity;

  @OneToMany(() => HtsNoteRateEntity, (rate) => rate.note)
  rates?: HtsNoteRateEntity[];

  @OneToMany(() => HtsNoteReferenceEntity, (reference) => reference.note)
  references?: HtsNoteReferenceEntity[];
}
