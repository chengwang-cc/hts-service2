import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('marketplace_reviews')
@Index(['requestId'], { unique: true })
@Index(['brokerProfileId'])
@Index(['reviewerOrganizationId'])
@Index(['moderationStatus'])
@Index(['rating'])
export class MarketplaceReviewEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  requestId: string;

  @Column('uuid')
  brokerProfileId: string;

  @Column('uuid')
  brokerOrganizationId: string;

  @Column('uuid')
  reviewerOrganizationId: string;

  @Column('uuid')
  reviewerUserId: string;

  @Column('int')
  rating: number;

  @Column('jsonb', { default: [] })
  tags: string[];

  @Column('text', { nullable: true })
  comment: string | null;

  @Column('varchar', { length: 40, default: 'pending' })
  moderationStatus: 'pending' | 'approved' | 'hidden' | 'rejected';

  @Column('uuid', { nullable: true })
  moderatedByUserId: string | null;

  @Column('timestamp', { nullable: true })
  moderatedAt: Date | null;

  @Column('text', { nullable: true })
  moderationNote: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
