import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('hts_documents')
@Index(['year', 'chapter', 'documentType'])
export class HtsDocumentEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('int')
  year: number;

  @Column('varchar', { length: 3 })
  chapter: string;

  @Column('varchar', { length: 50, name: 'type', default: 'GENERAL' })
  documentType: string;

  @Column('varchar', { length: 50 })
  sourceVersion: string;

  @Column('text', { name: 'url' })
  sourceUrl: string;

  @Column('bytea', { nullable: true, name: 'pdf_buffer' })
  pdfData: Buffer | null;

  @Column('text', { nullable: true })
  parsedText: string | null;

  @Column('integer', { nullable: true, name: 'num_pages' })
  numPages: number | null;

  @Column('varchar', { length: 20, default: 'PENDING' })
  status: string;

  @Column('text', { nullable: true, name: 'error_message' })
  errorMessage: string | null;

  @Column('varchar', { length: 64, nullable: true, name: 'hash' })
  fileHash: string | null;

  @Column('integer', { nullable: true, name: 'file_size' })
  fileSize: number | null;

  @Column('timestamp', { nullable: true })
  downloadedAt: Date | null;

  @Column('timestamp', { nullable: true })
  parsedAt: Date | null;

  @Column('timestamp', { nullable: true, name: 'processed_at' })
  processedAt: Date | null;

  @Column('boolean', { default: false })
  isParsed: boolean;

  @Column('jsonb', { nullable: true })
  metadata: Record<string, any> | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
