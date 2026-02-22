import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('lookup_conversation_sessions')
@Index(['organizationId'])
@Index(['status'])
export class LookupConversationSessionEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('varchar', { length: 100, nullable: true })
  organizationId: string | null;

  @Column('varchar', { length: 200, nullable: true })
  userProfile: string | null;

  @Column('varchar', { length: 30, default: 'active' })
  status: 'active' | 'closed';

  @Column('jsonb', { nullable: true })
  contextJson: Record<string, any> | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
