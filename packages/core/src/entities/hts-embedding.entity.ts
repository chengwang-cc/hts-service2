import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * HTS Embedding Entity - Vector embeddings for semantic search
 * Uses pgvector extension for similarity search
 */
@Entity('hts_embeddings')
export class HtsEmbeddingEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /**
   * HTS Number - Reference to HTS entry
   */
  @Column('varchar', { length: 20, unique: true })
  htsNumber: string;

  /**
   * Embedding Vector - 1536-dimensional vector from OpenAI text-embedding-3-small
   * Stored using pgvector extension
   */
  @Column({ type: 'vector', length: 1536 })
  embedding: number[];

  /**
   * Search Text - Concatenated text used to generate embedding
   * Format: "{htsNumber} {description} {chapter_context}"
   */
  @Column('text')
  searchText: string;

  /**
   * Search Vector - Full-text search tsvector for keyword search
   * Used in hybrid search (semantic + keyword)
   */
  @Column({ type: 'tsvector', nullable: true })
  searchVector: string | null;

  /**
   * Model - OpenAI model used to generate embedding
   */
  @Column('varchar', { length: 50, default: 'text-embedding-3-small' })
  model: string;

  /**
   * Model Version - Version of the embedding model
   */
  @Column('varchar', { length: 20, nullable: true })
  modelVersion: string | null;

  /**
   * Generated At - When this embedding was generated
   */
  @Column('timestamp', { default: () => 'CURRENT_TIMESTAMP' })
  generatedAt: Date;

  /**
   * Is Current - Whether this is the current active embedding
   * Allows for versioning when re-generating embeddings
   */
  @Column('boolean', { default: true })
  isCurrent: boolean;

  /**
   * Metadata - Additional embedding metadata
   * Can store: generation cost, token count, etc.
   */
  @Column('jsonb', { nullable: true })
  metadata: Record<string, any> | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

}
