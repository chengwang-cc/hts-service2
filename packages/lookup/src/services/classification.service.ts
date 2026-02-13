import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OpenAiService } from '@hts/core';
import { ProductClassificationEntity } from '../entities/product-classification.entity';

@Injectable()
export class ClassificationService {
  private readonly logger = new Logger(ClassificationService.name);

  constructor(
    @InjectRepository(ProductClassificationEntity)
    private readonly classificationRepository: Repository<ProductClassificationEntity>,
    private readonly openAiService: OpenAiService,
  ) {}

  async classifyProduct(description: string, organizationId: string): Promise<any> {
    const input = `Classify this product into HTS code: "${description}".

Return JSON with: { htsCode, confidence, reasoning }.`;

    try {
      const response = await this.openAiService.response(input, {
        model: 'gpt-4o',
        instructions: 'You are an expert HTS classifier.',
        temperature: 0,
        store: false, // Don't store classification conversations
        text: {
          format: {
            type: 'json_schema',
            json_schema: {
              name: 'classification_response',
              schema: {
                type: 'object',
                properties: {
                  htsCode: { type: 'string' },
                  confidence: { type: 'number' },
                  reasoning: { type: 'string' },
                },
                required: ['htsCode', 'confidence', 'reasoning'],
                additionalProperties: false,
              },
              strict: true,
            },
          },
        },
      });

      const outputText = (response as any).output_text || '';
      if (!outputText) {
        throw new Error('OpenAI returned empty response');
      }

      const result = JSON.parse(outputText);

      const classification = this.classificationRepository.create({
        organizationId,
        productName: description.substring(0, 500),
        description,
        suggestedHts: result.htsCode,
        confidence: result.confidence,
        status: 'PENDING_CONFIRMATION',
        aiSuggestions: [result],
      });

      return this.classificationRepository.save(classification);
    } catch (error) {
      this.logger.error(`Classification failed: ${error.message}`);
      throw error;
    }
  }
}
