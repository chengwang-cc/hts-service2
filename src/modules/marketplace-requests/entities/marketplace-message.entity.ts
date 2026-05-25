import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('marketplace_messages')
@Index(['conversationId'])
@Index(['senderUserId'])
@Index(['createdAt'])
@Index(['conversationId', 'hidden'])
export class MarketplaceMessageEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  conversationId: string;

  @Column('uuid')
  senderUserId: string;

  @Column('uuid')
  senderOrganizationId: string;

  @Column('varchar', { length: 40, default: 'broker' })
  senderRole: 'broker' | 'business' | 'platform';

  @Column('text')
  body: string;

  @Column('jsonb', { nullable: true })
  attachments: Array<{
    storageKey: string;
    fileName: string;
    mimeType: string;
    byteSize: number;
    sharedFull: boolean;
  }> | null;

  @Column('jsonb', { nullable: true })
  metadata: Record<string, unknown> | null;

  /**
   * R1-A-04 moderation. When `hidden=true` the participant view returns a
   * redacted placeholder instead of body/attachments. Admins flip this via
   * POST /admin/marketplace/messages/:id/hide.
   */
  @Column('boolean', { default: false })
  hidden: boolean;

  @Column('uuid', { nullable: true })
  hiddenByUserId: string | null;

  @Column('timestamp', { nullable: true })
  hiddenAt: Date | null;

  @Column('text', { nullable: true })
  hiddenReason: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
