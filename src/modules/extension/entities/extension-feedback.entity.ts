import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

/**
 * Extension Feedback Entity
 * Stores user feedback from Chrome extension for ML improvement
 */
@Entity('extension_feedback')
@Index(['organizationId', 'createdAt'])
@Index(['productId'])
export class ExtensionFeedbackEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('varchar', { length: 255 })
  organizationId: string;

  @Column('varchar', { length: 255 })
  productId: string;

  @Column('varchar', { length: 100 })
  field: string;

  @Column('jsonb', { nullable: true })
  originalValue: any;

  @Column('jsonb', { nullable: true })
  correctedValue: any;

  @Column('text', { nullable: true })
  userComment: string | null;

  @Column('varchar', { length: 500, nullable: true })
  userAgent: string | null;

  @Column('varchar', { length: 1000, nullable: true })
  pageUrl: string | null;

  @Column('varchar', { length: 255, nullable: true })
  userId: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
