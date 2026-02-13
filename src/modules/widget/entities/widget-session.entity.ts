import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { WidgetConfigEntity } from './widget-config.entity';

/**
 * Widget Session Entity
 * Tracks individual widget sessions and interactions
 */
@Entity('widget_sessions')
@Index(['widgetId', 'createdAt'])
@Index(['sessionId'], { unique: true })
export class WidgetSessionEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /**
   * Unique session ID
   */
  @Column('varchar', { length: 100, unique: true })
  sessionId: string;

  /**
   * Widget configuration
   */
  @Column('uuid')
  widgetConfigId: string;

  @ManyToOne(() => WidgetConfigEntity)
  @JoinColumn({ name: 'widget_config_id' })
  widgetConfig: WidgetConfigEntity;

  /**
   * Widget ID (denormalized for faster queries)
   */
  @Column('varchar', { length: 100 })
  widgetId: string;

  /**
   * Organization ID (denormalized)
   */
  @Column('uuid')
  organizationId: string;

  /**
   * Referrer domain
   */
  @Column('varchar', { length: 500 })
  referrer: string;

  /**
   * Page URL where widget was loaded
   */
  @Column('varchar', { length: 1000 })
  pageUrl: string;

  /**
   * User agent
   */
  @Column('varchar', { length: 500, nullable: true })
  userAgent: string | null;

  /**
   * Client IP address
   */
  @Column('varchar', { length: 45, nullable: true })
  clientIp: string | null;

  /**
   * Session start time
   */
  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;

  /**
   * Session end time (null = still active)
   */
  @Column('timestamp', { nullable: true })
  endedAt: Date | null;

  /**
   * Total interactions in this session
   */
  @Column('integer', { default: 0 })
  interactionCount: number;

  /**
   * Interaction events
   * Example: [{ type: 'search', query: 'horses', timestamp: '...' }]
   */
  @Column('jsonb', { nullable: true })
  interactions: Array<{
    type: 'search' | 'lookup' | 'calculate' | 'view';
    data: any;
    timestamp: string;
  }> | null;

  /**
   * Session duration in seconds
   */
  @Column('integer', { nullable: true })
  durationSeconds: number | null;

  /**
   * Metadata
   */
  @Column('jsonb', { nullable: true })
  metadata: Record<string, any> | null;
}
