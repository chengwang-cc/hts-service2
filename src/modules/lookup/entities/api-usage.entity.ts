import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

/**
 * API Usage Entity
 * Tracks daily API usage for rate limiting
 * Separate from monthly billing usage records
 */
@Entity('api_usage')
@Index(['organizationId', 'date', 'endpoint'])
@Index(['ipAddress', 'date', 'endpoint'])
export class ApiUsageEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // For authenticated users
  @Column('uuid', { name: 'organization_id', nullable: true })
  organizationId: string | null;

  // For guest users
  @Column('varchar', { name: 'ip_address', length: 45, nullable: true })
  ipAddress: string | null; // Supports both IPv4 and IPv6

  // Which endpoint was called
  @Column('varchar', { length: 100 })
  endpoint: string; // e.g., 'classify-url', 'classify', 'search'

  // Date for daily tracking (date only, no time)
  @Column('date')
  date: Date;

  // Usage count for this endpoint on this date
  @Column('int', { default: 0 })
  count: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @CreateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
