import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { HtsDocumentEntity } from './hts-document.entity';

/**
 * Knowledge Chunk Entity
 * Stores text chunks and embeddings for semantic search
 */
@Entity('knowledge_chunks')
@Index(['documentId'])
@Index(['chunkIndex'])
@Index(['embeddingStatus'])
export class KnowledgeChunkEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /**
   * Document ID - Reference to parent document
   */
  @Column('uuid')
  documentId: string;

  /**
   * Chunk Index - Position in document (0-indexed)
   */
  @Column('integer')
  chunkIndex: number;

  /**
   * Content - Text content of this chunk
   */
  @Column('text')
  content: string;

  /**
   * Token Count - Number of tokens in content
   */
  @Column('integer')
  tokenCount: number;

  /**
   * Embedding - Vector embedding (1536 dimensions for OpenAI)
   */
  @Column({ type: 'vector', length: 1536, nullable: true })
  embedding: number[] | null;

  /**
   * Embedding Status - Status of embedding generation
   * Options: PENDING, GENERATED, FAILED
   */
  @Column('varchar', { length: 20, default: 'PENDING' })
  embeddingStatus: string;

  /**
   * Embedding Generated At - When embedding was created
   */
  @Column('timestamp', { nullable: true })
  embeddingGeneratedAt: Date | null;

  /**
   * Error Message - If embedding generation failed
   */
  @Column('text', { nullable: true })
  errorMessage: string | null;

  /**
   * Metadata - Additional metadata (page numbers, section titles, etc.)
   */
  @Column('jsonb', { nullable: true })
  metadata: Record<string, any> | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  /**
   * Document Relation
   */
  @ManyToOne(() => HtsDocumentEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'document_id' })
  document?: HtsDocumentEntity;
}
