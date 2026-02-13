import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { ApiKeyService } from '../src/modules/api-keys/services/api-key.service';

describe('Knowledgebase API (E2E)', () => {
  let app: INestApplication;
  let apiKeyService: ApiKeyService;
  let validApiKey: string;
  let testOrganizationId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();

    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: false,
        transformOptions: {
          enableImplicitConversion: true,
        },
      }),
    );

    await app.init();

    apiKeyService = moduleFixture.get<ApiKeyService>(ApiKeyService);
    testOrganizationId = 'kb-test-' + Date.now();

    // Generate API key with knowledgebase permission
    const result = await apiKeyService.generateApiKey({
      name: 'Knowledgebase Test Key',
      organizationId: testOrganizationId,
      environment: 'sandbox',
      permissions: ['kb:query'],
      rateLimitPerMinute: 100,
      rateLimitPerDay: 10000,
    });
    validApiKey = result.plainTextKey;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /api/v1/knowledgebase/query', () => {
    it('should query the knowledgebase with a question', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/knowledgebase/query')
        .set('X-API-Key', validApiKey)
        .send({
          question: 'What is the duty rate for importing cotton t-shirts from China?',
        })
        .expect(200);

      expect(response.body).toBeDefined();
      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
      expect(response.body.data.question).toBe(
        'What is the duty rate for importing cotton t-shirts from China?'
      );
      expect(response.body.data.results).toBeDefined();
      expect(Array.isArray(response.body.data.results)).toBe(true);
    });

    it('should return relevant HTS codes for the question', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/knowledgebase/query')
        .set('X-API-Key', validApiKey)
        .send({
          question: 'What are the tariffs for live horses?',
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.results.length).toBeGreaterThan(0);

      // Results should be relevant to horses
      const firstResult = response.body.data.results[0];
      expect(firstResult).toHaveProperty('htsNumber');
      expect(firstResult).toHaveProperty('description');
      expect(firstResult).toHaveProperty('score');
    });

    it('should handle questions with context', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/knowledgebase/query')
        .set('X-API-Key', validApiKey)
        .send({
          question: 'What are the import duties?',
          context: {
            countryOfOrigin: 'CN',
            productCategory: 'textiles',
          },
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.results).toBeDefined();
    });

    it('should reject missing question', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/knowledgebase/query')
        .set('X-API-Key', validApiKey)
        .send({
          context: { countryOfOrigin: 'CN' },
        })
        .expect(400);

      expect(response.body.message).toContain('Question is required');
    });

    it('should reject empty question', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/knowledgebase/query')
        .set('X-API-Key', validApiKey)
        .send({
          question: '',
        })
        .expect(400);

      expect(response.body.message).toContain('Question is required');
    });

    it('should handle complex natural language questions', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/knowledgebase/query')
        .set('X-API-Key', validApiKey)
        .send({
          question: 'I want to import cotton t-shirts with printed graphics from Mexico under USMCA. What are my duties?',
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.results.length).toBeGreaterThan(0);
    });

    it('should handle questions about specific HTS codes', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/knowledgebase/query')
        .set('X-API-Key', validApiKey)
        .send({
          question: 'Tell me about HTS code 6109.10.00',
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.results).toBeDefined();
    });

    it('should handle questions about trade agreements', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/knowledgebase/query')
        .set('X-API-Key', validApiKey)
        .send({
          question: 'What products qualify for USMCA preferential treatment?',
        })
        .expect(200);

      expect(response.body.success).toBe(true);
    });

    it('should require authentication', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/knowledgebase/query')
        .send({
          question: 'What is the duty rate?',
        })
        .expect(401);
    });

    it('should enforce permission requirements', async () => {
      // Create a key without kb:query permission
      const noKbResult = await apiKeyService.generateApiKey({
        name: 'No KB Permission Key',
        organizationId: testOrganizationId,
        environment: 'sandbox',
        permissions: ['hts:lookup'], // Different permission
      });

      await request(app.getHttpServer())
        .post('/api/v1/knowledgebase/query')
        .set('X-API-Key', noKbResult.plainTextKey)
        .send({
          question: 'What is the duty rate?',
        })
        .expect(403);
    });
  });

  describe('POST /api/v1/knowledgebase/recommend', () => {
    it('should recommend HTS codes for a product description', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/knowledgebase/recommend')
        .set('X-API-Key', validApiKey)
        .send({
          productDescription: 'Cotton t-shirts with printed graphics, crew neck, short sleeves',
        })
        .expect(200);

      expect(response.body).toBeDefined();
      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.data.length).toBeGreaterThan(0);
    });

    it('should return HTS codes with descriptions and scores', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/knowledgebase/recommend')
        .set('X-API-Key', validApiKey)
        .send({
          productDescription: 'Leather boots for hiking',
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      const recommendations = response.body.data;

      expect(recommendations.length).toBeGreaterThan(0);

      const firstRecommendation = recommendations[0];
      expect(firstRecommendation).toHaveProperty('htsNumber');
      expect(firstRecommendation).toHaveProperty('description');
      expect(firstRecommendation).toHaveProperty('score');
    });

    it('should respect limit parameter', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/knowledgebase/recommend')
        .set('X-API-Key', validApiKey)
        .send({
          productDescription: 'Cotton fabric',
          limit: 3,
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.length).toBeLessThanOrEqual(3);
      expect(response.body.meta.limit).toBe(3);
    });

    it('should default to limit of 5', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/knowledgebase/recommend')
        .set('X-API-Key', validApiKey)
        .send({
          productDescription: 'Textile products',
        })
        .expect(200);

      expect(response.body.data.length).toBeLessThanOrEqual(5);
    });

    it('should handle detailed product descriptions', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/knowledgebase/recommend')
        .set('X-API-Key', validApiKey)
        .send({
          productDescription: 'Mens casual cotton t-shirts, 100% cotton, short sleeve, crew neck, printed with graphics, sizes S-XL, retail packaged',
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.length).toBeGreaterThan(0);

      // Should find relevant clothing/textile codes
      const descriptions = response.body.data
        .map((item: any) => item.description.toLowerCase())
        .join(' ');

      expect(
        descriptions.includes('cotton') ||
        descriptions.includes('shirt') ||
        descriptions.includes('apparel') ||
        descriptions.includes('garment')
      ).toBe(true);
    });

    it('should handle product descriptions with technical terms', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/knowledgebase/recommend')
        .set('X-API-Key', validApiKey)
        .send({
          productDescription: 'Polyester woven fabric, 60% polyester 40% cotton blend, twill weave',
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.length).toBeGreaterThan(0);
    });

    it('should handle product descriptions with brand names', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/knowledgebase/recommend')
        .set('X-API-Key', validApiKey)
        .send({
          productDescription: 'Nike athletic shoes, synthetic leather upper, rubber sole',
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      // Should find footwear-related codes despite brand name
    });

    it('should reject missing product description', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/knowledgebase/recommend')
        .set('X-API-Key', validApiKey)
        .send({
          limit: 5,
        })
        .expect(400);

      expect(response.body.message).toContain('Product description is required');
    });

    it('should reject empty product description', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/knowledgebase/recommend')
        .set('X-API-Key', validApiKey)
        .send({
          productDescription: '',
        })
        .expect(400);

      expect(response.body.message).toContain('Product description is required');
    });

    it('should require authentication', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/knowledgebase/recommend')
        .send({
          productDescription: 'Cotton t-shirts',
        })
        .expect(401);
    });

    it('should enforce permission requirements', async () => {
      // Create a key without kb:query permission
      const noKbResult = await apiKeyService.generateApiKey({
        name: 'No KB Permission Key 2',
        organizationId: testOrganizationId,
        environment: 'sandbox',
        permissions: ['hts:calculate'],
      });

      await request(app.getHttpServer())
        .post('/api/v1/knowledgebase/recommend')
        .set('X-API-Key', noKbResult.plainTextKey)
        .send({
          productDescription: 'Cotton t-shirts',
        })
        .expect(403);
    });
  });

  describe('Response Format & Metadata', () => {
    it('should return consistent response format', async () => {
      const queryResponse = await request(app.getHttpServer())
        .post('/api/v1/knowledgebase/query')
        .set('X-API-Key', validApiKey)
        .send({
          question: 'What is the duty rate?',
        })
        .expect(200);

      expect(queryResponse.body).toHaveProperty('success');
      expect(queryResponse.body).toHaveProperty('data');
      expect(queryResponse.body).toHaveProperty('meta');

      const recommendResponse = await request(app.getHttpServer())
        .post('/api/v1/knowledgebase/recommend')
        .set('X-API-Key', validApiKey)
        .send({
          productDescription: 'Cotton fabric',
        })
        .expect(200);

      expect(recommendResponse.body).toHaveProperty('success');
      expect(recommendResponse.body).toHaveProperty('data');
      expect(recommendResponse.body).toHaveProperty('meta');
    });

    it('should include API version in metadata', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/knowledgebase/query')
        .set('X-API-Key', validApiKey)
        .send({
          question: 'What is the duty rate?',
        })
        .expect(200);

      expect(response.body.meta.apiVersion).toBe('v1');
    });

    it('should include organization ID in metadata', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/knowledgebase/query')
        .set('X-API-Key', validApiKey)
        .send({
          question: 'What is the duty rate?',
        })
        .expect(200);

      expect(response.body.meta.organizationId).toBe(testOrganizationId);
    });
  });

  describe('Rate Limiting', () => {
    it('should include rate limit headers', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/knowledgebase/query')
        .set('X-API-Key', validApiKey)
        .send({
          question: 'What is the duty rate?',
        })
        .expect(200);

      expect(response.headers['x-ratelimit-limit-minute']).toBeDefined();
      expect(response.headers['x-ratelimit-remaining-minute']).toBeDefined();
      expect(response.headers['x-ratelimit-limit-day']).toBeDefined();
      expect(response.headers['x-ratelimit-remaining-day']).toBeDefined();
    });
  });

  describe('Error Handling', () => {
    it('should return proper error format', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/knowledgebase/query')
        .set('X-API-Key', validApiKey)
        .send({})
        .expect(400);

      expect(response.body).toHaveProperty('statusCode');
      expect(response.body).toHaveProperty('message');
      expect(response.body).toHaveProperty('error');
      expect(response.body.statusCode).toBe(400);
    });

    it('should handle invalid JSON gracefully', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/knowledgebase/query')
        .set('X-API-Key', validApiKey)
        .set('Content-Type', 'application/json')
        .send('invalid json')
        .expect(400);

      expect(response.body).toHaveProperty('statusCode');
    });
  });

  describe('AI/Semantic Search Quality', () => {
    it('should understand synonyms and related terms', async () => {
      // Test that "clothes" matches "apparel", "garments", etc.
      const response = await request(app.getHttpServer())
        .post('/api/v1/knowledgebase/recommend')
        .set('X-API-Key', validApiKey)
        .send({
          productDescription: 'clothes for men',
        })
        .expect(200);

      expect(response.body.data.length).toBeGreaterThan(0);

      const descriptions = response.body.data
        .map((item: any) => item.description.toLowerCase())
        .join(' ');

      // Should find clothing-related items
      expect(
        descriptions.includes('apparel') ||
        descriptions.includes('garment') ||
        descriptions.includes('clothing') ||
        descriptions.includes('wearing')
      ).toBe(true);
    });

    it('should handle misspellings gracefully', async () => {
      // Test with common misspelling
      const response = await request(app.getHttpServer())
        .post('/api/v1/knowledgebase/recommend')
        .set('X-API-Key', validApiKey)
        .send({
          productDescription: 'cotten tshirts', // Misspelled "cotton" and "t-shirts"
        })
        .expect(200);

      // Should still return relevant results
      expect(response.body.success).toBe(true);
    });

    it('should rank results by relevance', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/knowledgebase/recommend')
        .set('X-API-Key', validApiKey)
        .send({
          productDescription: 'Cotton t-shirts',
        })
        .expect(200);

      const results = response.body.data;

      // Results should be ordered by score (descending)
      for (let i = 0; i < results.length - 1; i++) {
        expect(results[i].score).toBeGreaterThanOrEqual(results[i + 1].score);
      }
    });
  });
});
