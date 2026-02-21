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

  /**
   * Checkpoint - Crash recovery checkpoint data
   * Format: { stage, s3Key, processedChunks, totalChunks, etc }
   */
  @Column('jsonb', { nullable: true })
  @Index()
  checkpoint: Record<string, any> | null;

  /**
   * S3 Bucket - Where raw PDF/document is stored
   */
  @Column('varchar', { length: 255, nullable: true })
  s3Bucket: string | null;

  /**
   * S3 Key - Path to raw document file in S3
   */
  @Column('varchar', { length: 500, nullable: true })
  s3Key: string | null;

  /**
   * S3 File Hash - SHA-256 hash of S3 file for verification
   */
  @Column('varchar', { length: 64, nullable: true })
  s3FileHash: string | null;

  /**
   * Job ID - pg-boss job ID for tracking
   */
  @Column('varchar', { length: 100, nullable: true })
  @Index()
  jobId: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
