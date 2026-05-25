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
import { MarketplaceBrokerProfileEntity } from './marketplace-broker-profile.entity';

@Entity('marketplace_broker_credentials')
@Index(['brokerProfileId'])
@Index(['organizationId'])
@Index(['credentialType'])
@Index(['verificationStatus'])
export class MarketplaceBrokerCredentialEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  brokerProfileId: string;

  @Column('uuid')
  organizationId: string;

  @Column('varchar', { length: 80 })
  credentialType: string;

  @Column('varchar', { length: 160 })
  label: string;

  @Column('varchar', { length: 160, nullable: true })
  issuingAuthority: string | null;

  @Column('varchar', { length: 16, nullable: true })
  identifierLast4: string | null;

  @Column('jsonb', { nullable: true })
  encryptedValue: {
    algorithm: 'aes-256-gcm';
    ciphertext: string;
    iv: string;
    authTag: string;
    keyVersion: string;
  } | null;

  @Column('varchar', { length: 40, default: 'pending' })
  verificationStatus: 'pending' | 'verified' | 'rejected';

  @Column('timestamp', { nullable: true })
  expiresAt: Date | null;

  @Column('jsonb', { nullable: true })
  metadata: Record<string, unknown> | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @ManyToOne(
    () => MarketplaceBrokerProfileEntity,
    (profile) => profile.credentials,
    { onDelete: 'CASCADE' },
  )
  @JoinColumn({ name: 'broker_profile_id' })
  profile?: MarketplaceBrokerProfileEntity;
}
