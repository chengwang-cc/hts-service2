import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { HtsEntity, HtsEmbeddingEntity, EmbeddingService } from '@hts/core';

@Injectable()
export class SearchService {
  private readonly logger = new Logger(SearchService.name);

  constructor(
    @InjectRepository(HtsEntity)
    private readonly htsRepository: Repository<HtsEntity>,
    @InjectRepository(HtsEmbeddingEntity)
    private readonly embeddingRepository: Repository<HtsEmbeddingEntity>,
    private readonly embeddingService: EmbeddingService,
  ) {}

  async hybridSearch(query: string, limit: number = 20): Promise<any[]> {
    let semanticResults: Array<{ htsNumber: string; similarity: number }> = [];
    try {
      const embedding = await this.embeddingService.generateEmbedding(query);
      semanticResults = await this.embeddingRepository
        .createQueryBuilder('emb')
        .select('emb.htsNumber', 'htsNumber')
        .addSelect('1 - (emb.embedding <=> :embedding)', 'similarity')
        .setParameter('embedding', JSON.stringify(embedding))
        .orderBy('similarity', 'DESC')
        .limit(limit)
        .getRawMany();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Semantic search unavailable, falling back to keyword-only search: ${message}`,
      );
    }

    const keywordResults = await this.htsRepository
      .createQueryBuilder('hts')
      .where('(hts.description ILIKE :query OR hts.htsNumber ILIKE :query)', {
        query: `%${query}%`,
      })
      .andWhere('hts.isActive = :active', { active: true })
      .limit(limit)
      .getMany();

    const combined = this.combineResults(semanticResults, keywordResults, limit);
    if (combined.length === 0) {
      return [];
    }

    const htsNumbers = combined.map((result) => result.htsNumber);
    const entries = await this.htsRepository.find({
      where: {
        htsNumber: In(htsNumbers),
        isActive: true,
      },
      select: ['htsNumber', 'description'],
    });
    const descriptionsByHts = new Map(
      entries.map((entry) => [entry.htsNumber, entry.description]),
    );

    return combined.map((result) => ({
      ...result,
      description: descriptionsByHts.get(result.htsNumber) ?? '',
    }));
  }

  private combineResults(
    semantic: Array<{ htsNumber: string; similarity: number }>,
    keyword: HtsEntity[],
    limit: number,
  ): Array<{ htsNumber: string; score: number }> {
    const combined = new Map();

    semantic.forEach((r, i) => {
      combined.set(r.htsNumber, {
        htsNumber: r.htsNumber,
        score: r.similarity * 0.7 + (1 - i / semantic.length) * 0.3,
      });
    });

    keyword.forEach((r, i) => {
      const existing = combined.get(r.htsNumber);
      const keywordScore = (1 - i / keyword.length) * 0.3;

      if (existing) {
        existing.score += keywordScore;
      } else {
        combined.set(r.htsNumber, { htsNumber: r.htsNumber, score: keywordScore });
      }
    });

    return Array.from(combined.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }
}
