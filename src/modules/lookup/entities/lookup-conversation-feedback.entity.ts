import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

@Entity('lookup_conversation_feedback')
@Index(['sessionId', 'createdAt'])
@Index(['isCorrect'])
export class LookupConversationFeedbackEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  sessionId: string;

  @Column('uuid', { nullable: true })
  messageId: string | null;

  @Column('boolean')
  isCorrect: boolean;

  @Column('varchar', { length: 20, nullable: true })
  chosenHts: string | null;

  @Column('text', { nullable: true })
  comment: string | null;

  @Column('jsonb', { nullable: true })
  metadata: Record<string, any> | null;

  @CreateDateColumn()
  createdAt: Date;
}
