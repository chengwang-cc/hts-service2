import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('policy_documents')
@Index(['sourceId'])
@Index(['sourceId', 'externalId'], { unique: true })
@Index(['status'])
@Index(['publishedAt'])
export class PolicyDocumentEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid', { nullable: true })
  sourceId: string | null;

  @Column('varchar', { length: 128 })
  sourceName: string;

  @Column('varchar', { length: 255 })
  externalId: string;

  @Column('text')
  title: string;

  @Column('text', { nullable: true })
  documentUrl: string | null;

  @Column('text', { nullable: true })
  snapshotUri: string | null;

  @Column('text', { nullable: true })
  documentText: string | null;

  @Column('varchar', { length: 128, nullable: true })
  contentHash: string | null;

  @Column('timestamptz', { nullable: true })
  publishedAt: Date | null;

  @Column('timestamptz', { default: () => 'CURRENT_TIMESTAMP' })
  fetchedAt: Date;

  @Column('varchar', { length: 32, default: 'fetched' })
  status: string;

  @Column('jsonb', { nullable: true })
  metadata: Record<string, unknown> | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
