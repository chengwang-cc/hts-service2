import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('broker_audit_packs')
@Index(['brokerOrganizationId'])
@Index(['entryId'])
@Index(['createdAt'])
export class BrokerAuditPackEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  brokerOrganizationId: string;

  @Column('uuid')
  entryId: string;

  @Column('varchar', { length: 80 })
  format: 'json' | 'pdf' | 'html';

  @Column('varchar', { length: 512, nullable: true })
  storageKey: string | null;

  @Column('varchar', { length: 120, nullable: true })
  sha256: string | null;

  @Column('int', { nullable: true })
  byteSize: number | null;

  @Column('jsonb')
  manifest: Record<string, unknown>;

  @Column('uuid')
  generatedByUserId: string;

  @CreateDateColumn()
  createdAt: Date;
}
