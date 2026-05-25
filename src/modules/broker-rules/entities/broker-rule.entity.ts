import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('broker_rules')
@Index(['scope'])
@Index(['enabled'])
@Index(['organizationId'])
@Index(['code'], { unique: true })
export class BrokerRuleEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid', { nullable: true })
  organizationId: string | null;

  @Column('varchar', { length: 80 })
  code: string;

  @Column('varchar', { length: 200 })
  title: string;

  @Column('text', { nullable: true })
  description: string | null;

  @Column('varchar', { length: 40, default: 'system' })
  scope: 'system' | 'organization' | 'client';

  @Column('uuid', { nullable: true })
  clientId: string | null;

  @Column('varchar', { length: 20, default: 'warning' })
  severity: 'info' | 'warning' | 'blocker';

  @Column('varchar', { length: 60 })
  ruleType:
    | 'required_field'
    | 'hts_format'
    | 'country_of_origin'
    | 'unit_of_measure'
    | 'value_threshold'
    | 'poa_required'
    | 'docs_required'
    | 'policy_exposure';

  @Column('jsonb')
  config: Record<string, unknown>;

  @Column('boolean', { default: true })
  enabled: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
