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
import { BrokerDocumentPacketEntity } from './broker-document-packet.entity';

@Entity('broker_documents')
@Index(['packetId'])
@Index(['brokerOrganizationId'])
@Index(['documentType'])
@Index(['scanStatus'])
@Index(['sha256'])
export class BrokerDocumentEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  packetId: string;

  @Column('uuid')
  brokerOrganizationId: string;

  @Column('uuid')
  clientId: string;

  @Column('varchar', { length: 60, default: 'unknown' })
  documentType:
    | 'unknown'
    | 'commercial_invoice'
    | 'packing_list'
    | 'bol'
    | 'awb'
    | 'arrival_notice'
    | 'origin_certificate'
    | 'isf'
    | 'poa'
    | 'other';

  @Column('numeric', { precision: 5, scale: 2, nullable: true })
  documentTypeConfidence: string | null;

  @Column('varchar', { length: 255 })
  fileName: string;

  @Column('varchar', { length: 120 })
  mimeType: string;

  @Column('int')
  byteSize: number;

  @Column('int', { nullable: true })
  pageCount: number | null;

  @Column('varchar', { length: 120 })
  sha256: string;

  @Column('varchar', { length: 512 })
  storageKey: string;

  @Column('varchar', { length: 20, default: 'pending' })
  scanStatus: 'pending' | 'clean' | 'blocked' | 'unavailable';

  @Column('varchar', { length: 80, nullable: true })
  scanProvider: string | null;

  @Column('varchar', { length: 200, nullable: true })
  scanReason: string | null;

  @Column('jsonb', { nullable: true })
  metadata: Record<string, unknown> | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @ManyToOne(() => BrokerDocumentPacketEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'packet_id' })
  packet?: BrokerDocumentPacketEntity;
}
