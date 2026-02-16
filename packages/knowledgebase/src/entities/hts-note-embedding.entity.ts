import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { HtsNoteEntity } from './hts-note.entity';

@Entity('hts_note_embeddings')
@Index(['isCurrent'])
export class HtsNoteEmbeddingEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid', { unique: true })
  noteId: string;

  @Column({ type: 'vector', length: 1536 })
  embedding: number[];

  @Column('text')
  searchText: string;

  @Column({ type: 'tsvector', nullable: true })
  searchVector: string | null;

  @Column('varchar', { length: 50, default: 'text-embedding-3-small' })
  model: string;

  @Column('timestamp', { default: () => 'CURRENT_TIMESTAMP' })
  generatedAt: Date;

  @Column('boolean', { default: true })
  isCurrent: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @OneToOne(() => HtsNoteEntity, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'note_id' })
  note?: HtsNoteEntity;
}
