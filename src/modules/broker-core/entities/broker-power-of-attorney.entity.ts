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
import { BrokerClientEntity } from './broker-client.entity';

@Entity('broker_power_of_attorneys')
@Index(['clientId'])
@Index(['brokerOrganizationId'])
@Index(['status'])
@Index(['effectiveDate'])
export class BrokerPowerOfAttorneyEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  clientId: string;

  @Column('uuid')
  brokerOrganizationId: string;

  @Column('varchar', { length: 40, default: 'missing' })
  status: 'missing' | 'pending' | 'verified' | 'expired' | 'revoked';

  @Column('varchar', { length: 80, default: 'continuous' })
  poaType: 'continuous' | 'single_transaction' | 'limited';

  @Column('timestamp', { nullable: true })
  effectiveDate: Date | null;

  @Column('timestamp', { nullable: true })
  expiresAt: Date | null;

  @Column('varchar', { length: 512, nullable: true })
  documentStorageKey: string | null;

  @Column('varchar', { length: 120, nullable: true })
  documentSha256: string | null;

  @Column('uuid', { nullable: true })
  verifiedByUserId: string | null;

  @Column('timestamp', { nullable: true })
  verifiedAt: Date | null;

  @Column('text', { nullable: true })
  notes: string | null;

  @Column('jsonb', { nullable: true })
  metadata: Record<string, unknown> | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @ManyToOne(() => BrokerClientEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'client_id' })
  client?: BrokerClientEntity;
}
