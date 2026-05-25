import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('broker_adapters')
@Index(['organizationId'])
@Index(['adapterType'])
@Index(['status'])
@Index(['organizationId', 'adapterType'], { unique: false })
export class BrokerAdapterEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  organizationId: string;

  @Column('varchar', { length: 60 })
  adapterType:
    | 'generic_csv'
    | 'json_webhook'
    | 'magaya_acelynk'
    | 'descartes'
    | 'cargowise'
    | 'catair_edi'
    | 'sftp_csv';

  @Column('varchar', { length: 200 })
  label: string;

  @Column('varchar', { length: 40, default: 'active' })
  status: 'active' | 'disabled' | 'pending_setup';

  @Column('jsonb', { nullable: true })
  encryptedConfig: {
    algorithm: 'aes-256-gcm';
    ciphertext: string;
    iv: string;
    authTag: string;
    keyVersion: string;
  } | null;

  @Column('jsonb', { nullable: true })
  publicConfig: Record<string, unknown> | null;

  @Column('jsonb', { nullable: true })
  fieldMappingProfile: Record<string, string> | null;

  @Column('timestamp', { nullable: true })
  lastTestedAt: Date | null;

  @Column('varchar', { length: 40, nullable: true })
  lastTestStatus: 'ok' | 'failed' | null;

  @Column('text', { nullable: true })
  lastTestMessage: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
