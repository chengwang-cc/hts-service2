import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('cbp_cross_rulings')
@Index(['collection', 'rulingNumber'], { unique: true })
@Index(['rulingDate'])
@Index(['status'])
@Index(['embeddingStatus'])
export class CbpCrossRulingEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('varchar', { length: 16 })
  collection: string;

  @Column('varchar', { length: 64 })
  rulingNumber: string;

  @Column('text')
  subject: string;

  @Column('date', { nullable: true })
  rulingDate: string | null;

  @Column('text', { nullable: true })
  categories: string | null;

  @Column('text', { array: true, default: () => "'{}'" })
  htsNumbers: string[];

  @Column('text')
  rulingText: string;

  @Column('text')
  sourceUrl: string;

  @Column('text', { nullable: true })
  documentUrl: string | null;

  @Column('varchar', { length: 32, default: 'active' })
  status: string;

  @Column('text', { nullable: true })
  embeddingSearchText: string | null;

  @Column({ type: 'vector', length: 1024, nullable: true, select: false })
  embedding: number[] | null;

  @Column({ type: 'vector', length: 1536, nullable: true, select: false })
  embeddingOpenai: number[] | null;

  @Column('varchar', { length: 64, nullable: true })
  embeddingModel: string | null;

  @Column('varchar', { length: 32, default: 'pending' })
  embeddingStatus: string;

  @Column('timestamptz', { nullable: true })
  embeddingGeneratedAt: Date | null;

  @Column('jsonb', { nullable: true })
  metadata: Record<string, unknown> | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
