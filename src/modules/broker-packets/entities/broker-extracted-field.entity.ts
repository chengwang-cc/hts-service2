import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { BrokerDocumentEntity } from './broker-document.entity';

@Entity('broker_extracted_fields')
@Index(['documentId'])
@Index(['packetId'])
@Index(['fieldPath'])
@Index(['acceptedStatus'])
export class BrokerExtractedFieldEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  documentId: string;

  @Column('uuid')
  packetId: string;

  @Column('varchar', { length: 120 })
  fieldPath: string;

  @Column('text', { nullable: true })
  rawValue: string | null;

  @Column('text', { nullable: true })
  normalizedValue: string | null;

  @Column('numeric', { precision: 5, scale: 2, nullable: true })
  confidence: string | null;

  @Column('int', { nullable: true })
  page: number | null;

  @Column('jsonb', { nullable: true })
  coordinates: {
    x: number;
    y: number;
    width: number;
    height: number;
  } | null;

  @Column('varchar', { length: 80, nullable: true })
  sourceModel: string | null;

  @Column('varchar', { length: 40, default: 'suggested' })
  acceptedStatus: 'suggested' | 'accepted' | 'overridden' | 'rejected';

  @Column('text', { nullable: true })
  reviewedValue: string | null;

  @Column('uuid', { nullable: true })
  reviewedByUserId: string | null;

  @Column('timestamp', { nullable: true })
  reviewedAt: Date | null;

  @Column('jsonb', { nullable: true })
  metadata: Record<string, unknown> | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @ManyToOne(() => BrokerDocumentEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'document_id' })
  document?: BrokerDocumentEntity;
}
