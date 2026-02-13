import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { OrganizationEntity } from '../../auth/entities/organization.entity';
import { ApiKeyEntity } from '../../api-keys/entities/api-key.entity';

/**
 * Widget Configuration Entity
 * Stores embeddable widget settings for organizations
 */
@Entity('widget_configs')
@Index(['widgetId'], { unique: true })
@Index(['organizationId', 'isActive'])
export class WidgetConfigEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /**
   * Unique widget ID (public identifier)
   */
  @Column('varchar', { length: 100, unique: true })
  widgetId: string;

  /**
   * Widget name
   */
  @Column('varchar', { length: 255 })
  name: string;

  /**
   * Organization that owns this widget
   */
  @Column('uuid')
  organizationId: string;

  @ManyToOne(() => OrganizationEntity)
  @JoinColumn({ name: 'organization_id' })
  organization: OrganizationEntity;

  /**
   * API key used by this widget
   */
  @Column('uuid')
  apiKeyId: string;

  @ManyToOne(() => ApiKeyEntity)
  @JoinColumn({ name: 'api_key_id' })
  apiKey: ApiKeyEntity;

  /**
   * Widget type
   */
  @Column('varchar', { length: 50 })
  widgetType: 'lookup' | 'calculator' | 'combined';

  /**
   * Allowed domains (CORS whitelist)
   * Example: ['https://example.com', 'https://app.example.com']
   */
  @Column('jsonb')
  allowedDomains: string[];

  /**
   * Widget styling configuration
   */
  @Column('jsonb', { nullable: true })
  styling: {
    primaryColor?: string;
    secondaryColor?: string;
    fontFamily?: string;
    borderRadius?: string;
    width?: string;
    height?: string;
    theme?: 'light' | 'dark' | 'auto';
    customCss?: string;
  } | null;

  /**
   * Widget features configuration
   */
  @Column('jsonb')
  features: {
    showDescription?: boolean;
    showRates?: boolean;
    showHierarchy?: boolean;
    enableCalculation?: boolean;
    enableSearch?: boolean;
    enableRecommendations?: boolean;
    showFootnotes?: boolean;
    maxResults?: number;
  };

  /**
   * Default values for the widget
   */
  @Column('jsonb', { nullable: true })
  defaults: {
    countryOfOrigin?: string;
    currency?: string;
    [key: string]: any;
  } | null;

  /**
   * Custom labels/text
   */
  @Column('jsonb', { nullable: true })
  labels: {
    searchPlaceholder?: string;
    calculateButton?: string;
    resultsTitle?: string;
    [key: string]: string | undefined;
  } | null;

  /**
   * Is the widget currently active?
   */
  @Column('boolean', { default: true })
  isActive: boolean;

  /**
   * Widget analytics enabled
   */
  @Column('boolean', { default: true })
  analyticsEnabled: boolean;

  /**
   * Rate limiting per domain
   */
  @Column('integer', { default: 1000 })
  rateLimitPerDay: number;

  /**
   * Metadata (for extensibility)
   */
  @Column('jsonb', { nullable: true })
  metadata: Record<string, any> | null;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt: Date;

  /**
   * User who created this widget
   */
  @Column('uuid', { nullable: true })
  createdBy: string | null;
}
