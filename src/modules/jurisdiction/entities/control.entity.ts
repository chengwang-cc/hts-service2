import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * ControlEntity - restricted / prohibited / license / quota rules per
 * jurisdiction and classification.
 */
@Entity('jurisdiction_controls')
@Index(['jurisdictionCode'])
@Index(['jurisdictionCode', 'classificationCode'])
@Index(['controlType'])
export class ControlEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('varchar', { length: 8 })
  jurisdictionCode: string;

  @Column('varchar', { length: 20 })
  classificationCode: string;

  /** 'license' | 'permit' | 'prohibited' | 'restricted' | 'quota' | 'controlled' */
  @Column('varchar', { length: 24 })
  controlType: string;

  /** 'block' | 'warn' | 'info' */
  @Column('varchar', { length: 16 })
  severity: string;

  @Column('text', { nullable: true })
  description: string | null;

  @Column('uuid', { nullable: true })
  sourceCitationId: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
