import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('broker_ai_suggestions')
@Index(['brokerOrganizationId'])
@Index(['targetType', 'targetId'])
@Index(['suggestionType'])
@Index(['status'])
@Index(['createdAt'])
export class BrokerAiSuggestionEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  brokerOrganizationId: string;

  @Column('varchar', { length: 60 })
  targetType:
    | 'broker_entry'
    | 'broker_entry_line'
    | 'broker_document_packet'
    | 'broker_document'
    | 'broker_missing_info_task';

  @Column('uuid')
  targetId: string;

  @Column('varchar', { length: 60 })
  suggestionType:
    | 'hts_classification'
    | 'origin'
    | 'value'
    | 'pga_disclaimer'
    | 'special_program'
    | 'document_field_fix'
    | 'missing_info_question'
    | 'reject_remediation';

  @Column('jsonb')
  value: Record<string, unknown>;

  @Column('numeric', { precision: 5, scale: 4, nullable: true })
  confidence: string | null;

  @Column('varchar', { length: 80 })
  modelVersion: string;

  @Column('jsonb', { nullable: true })
  evidence: {
    sourceDocumentIds?: string[];
    citations?: Array<{ kind: string; ref: string; url?: string }>;
    rationale?: string;
    inputs?: Record<string, unknown>;
    alternativesRejected?: Array<{ value: unknown; reason: string }>;
  } | null;

  @Column('varchar', { length: 40, default: 'pending' })
  status: 'pending' | 'accepted' | 'rejected' | 'overridden' | 'superseded';

  @Column('uuid', { nullable: true })
  decisionId: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
