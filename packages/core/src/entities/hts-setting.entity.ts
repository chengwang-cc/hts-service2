import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

/**
 * HTS Setting Entity - System settings and configuration
 * Stores global settings for HTS service operation
 */
@Entity('hts_settings')
@Index(['key'], { unique: true })
@Index(['category'])
export class HtsSettingEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /**
   * Key - Unique setting key (e.g., "usitc.current_version")
   */
  @Column('varchar', { length: 100, unique: true })
  key: string;

  /**
   * Value - Setting value (can be JSON)
   */
  @Column('text')
  value: string;

  /**
   * Data Type - Type of value for parsing
   * Options: STRING, NUMBER, BOOLEAN, JSON, DATE
   */
  @Column('varchar', { length: 20, default: 'STRING' })
  dataType: string;

  /**
   * Category - Setting category for organization
   * Examples: "usitc", "formula_generation", "knowledgebase", "calculation"
   */
  @Column('varchar', { length: 50, default: 'general' })
  category: string;

  /**
   * Description - What this setting controls
   */
  @Column('text', { nullable: true })
  description: string | null;

  /**
   * Is Editable - Whether this setting can be changed via UI
   */
  @Column('boolean', { default: true })
  isEditable: boolean;

  /**
   * Is Sensitive - Whether this is a sensitive value (e.g., API key)
   */
  @Column('boolean', { default: false })
  isSensitive: boolean;

  /**
   * Validation Rules - Validation rules for this setting (JSON)
   * Example: { "type": "number", "min": 0, "max": 100 }
   */
  @Column('jsonb', { nullable: true })
  validationRules: Record<string, any> | null;

  /**
   * Default Value - Default value if setting is deleted
   */
  @Column('text', { nullable: true })
  defaultValue: string | null;

  /**
   * Last Updated By - User who last updated this setting
   */
  @Column('varchar', { length: 255, nullable: true })
  lastUpdatedBy: string | null;

  /**
   * Effective Date - When this setting becomes effective
   */
  @Column('timestamp', { nullable: true })
  effectiveDate: Date | null;

  /**
   * Notes - Additional notes about this setting
   */
  @Column('text', { nullable: true })
  notes: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
