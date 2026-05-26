import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * One row per source-field → target-field mapping rule for a profile.
 * `transform` is the optional transform expression (e.g.
 * `{op: 'upper'}`, `{op: 'concat', sep: ' '}`).
 */
@Entity('data_transformer_mappings')
@Index(['profileId', 'targetField'], { unique: true })
@Index(['profileId'])
export class DataTransformerMappingEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  profileId: string;

  @Column('varchar', { length: 200 })
  sourceField: string;

  @Column('varchar', { length: 200 })
  targetField: string;

  @Column('jsonb', { nullable: true })
  transform: Record<string, unknown> | null;

  @Column('boolean', { default: false })
  required: boolean;

  @Column('text', { nullable: true })
  notes: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
