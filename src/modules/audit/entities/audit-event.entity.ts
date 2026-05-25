import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('audit_events')
@Index(['organizationId'])
@Index(['actorUserId'])
@Index(['eventType'])
@Index(['resourceType', 'resourceId'])
@Index(['createdAt'])
export class AuditEventEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('varchar', { length: 120 })
  eventType: string;

  @Column('uuid', { nullable: true })
  organizationId: string | null;

  @Column('uuid', { nullable: true })
  actorUserId: string | null;

  @Column('varchar', { length: 80 })
  resourceType: string;

  @Column('varchar', { length: 120, nullable: true })
  resourceId: string | null;

  @Column('varchar', { length: 64, nullable: true })
  source: string | null;

  @Column('varchar', { length: 80, nullable: true })
  ipAddress: string | null;

  @Column('varchar', { length: 512, nullable: true })
  userAgent: string | null;

  @Column('jsonb', { nullable: true })
  metadata: Record<string, unknown> | null;

  @CreateDateColumn()
  createdAt: Date;
}
