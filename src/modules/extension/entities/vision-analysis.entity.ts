import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

/**
 * Vision Analysis Entity
 * Stores image analysis results from GPT-4o vision
 * Used for tracking, deduplication, and feedback
 */
@Entity('vision_analysis')
@Index(['organizationId', 'createdAt'])
@Index(['imageHash'])
export class VisionAnalysisEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('varchar', { length: 255 })
  organizationId: string;

  @Column('varchar', { length: 64 })
  imageHash: string; // SHA-256 hash for deduplication

  @Column('varchar', { length: 2000, nullable: true })
  sourceUrl: string | null; // Original page URL (if provided)

  @Column('jsonb')
  analysisResult: {
    products: Array<{
      name: string;
      description: string;
      price?: {
        value: number;
        currency: string;
      };
      category?: string;
      brand?: string;
      materials?: string[];
      confidence: number;
    }>;
    overallConfidence: number;
    modelVersion: string;
  };

  @Column('varchar', { length: 50 })
  modelUsed: string; // e.g., 'gpt-4o'

  @Column('int')
  processingTimeMs: number;

  @Column('int')
  imageSizeBytes: number;

  @Column('varchar', { length: 50 })
  imageFormat: string; // 'png', 'jpeg', 'webp'

  @Column('int', { nullable: true })
  tokensUsed: number | null;

  @CreateDateColumn()
  createdAt: Date;
}
