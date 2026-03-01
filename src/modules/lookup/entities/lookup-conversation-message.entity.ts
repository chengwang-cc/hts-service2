import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

@Entity('lookup_conversation_messages')
@Index(['sessionId', 'createdAt'])
@Index(['role'])
export class LookupConversationMessageEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  sessionId: string;

  @Column('varchar', { length: 20 })
  role: 'user' | 'assistant';

  @Column('jsonb')
  contentJson: Record<string, any>;

  @Column('jsonb', { nullable: true })
  toolTraceJson: string[] | null;

  @Column('jsonb', { nullable: true })
  tokenUsage: Record<string, any> | null;

  @Column('varchar', { length: 20, default: 'complete' })
  status: 'pending' | 'processing' | 'complete' | 'failed';

  @Column('text', { nullable: true })
  errorMessage: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
