import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('onboarding_progress')
@Index(['organizationId'])
@Index(['userId'])
export class OnboardingProgressEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid', { name: 'organization_id' })
  organizationId: string;

  @Column('uuid', { name: 'user_id' })
  userId: string;

  @Column('varchar', { length: 50 })
  persona: 'merchant' | 'broker' | 'developer';

  @Column('varchar', { length: 50 })
  currentStep: string;

  @Column('jsonb', { default: {} })
  completedSteps: Record<string, {
    completedAt: string;
    metadata?: Record<string, any>;
  }>;

  @Column('jsonb', { nullable: true })
  wizardData: Record<string, any> | null;

  @Column('boolean', { default: false })
  isComplete: boolean;

  @Column('timestamp', { name: 'completed_at', nullable: true })
  completedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
