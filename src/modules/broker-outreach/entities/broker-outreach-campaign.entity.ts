import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('broker_outreach_campaigns')
@Index(['status', 'createdAt'])
export class BrokerOutreachCampaignEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('varchar', { length: 180 })
  name: string;

  @Column('varchar', { length: 24, default: 'draft' })
  status: 'draft' | 'active' | 'paused' | 'completed' | string;

  @Column('text', { nullable: true })
  audience: string | null;

  @Column('text', { nullable: true })
  objective: string | null;

  @Column('varchar', { length: 255, nullable: true })
  emailSubject: string | null;

  @Column('text', { nullable: true })
  emailBody: string | null;

  @Column('text', { nullable: true })
  aiPrompt: string | null;

  @Column('jsonb', { nullable: true })
  metrics: Record<string, unknown> | null;

  @Column('jsonb', { nullable: true })
  metadata: Record<string, unknown> | null;

  @Column('varchar', { length: 200, default: 'system' })
  createdBy: string;

  @Column('varchar', { length: 200, default: 'system' })
  updatedBy: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
