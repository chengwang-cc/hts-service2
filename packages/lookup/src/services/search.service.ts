import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
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
    const embedding = await this.embeddingService.generateEmbedding(query);

    const semanticResults = await this.embeddingRepository
      .createQueryBuilder('emb')
      .select('emb.htsNumber', 'htsNumber')
      .addSelect('1 - (emb.embedding <=> :embedding)', 'similarity')
      .setParameter('embedding', JSON.stringify(embedding))
      .orderBy('similarity', 'DESC')
      .limit(limit)
      .getRawMany();

    const keywordResults = await this.htsRepository
      .createQueryBuilder('hts')
      .where('(hts.description ILIKE :query OR hts.htsNumber ILIKE :query)', {
        query: `%${query}%`,
      })
      .andWhere('hts.isActive = :active', { active: true })
      .limit(limit)
      .getMany();

    return this.combineResults(semanticResults, keywordResults);
  }

  private combineResults(semantic: any[], keyword: any[]): any[] {
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
      .slice(0, 20);
  }
}
