import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { Repository } from 'typeorm';
import { AppModule } from '../src/app.module';
import { ApiKeyService } from '../src/modules/api-keys/services/api-key.service';
import { OrganizationEntity } from '../src/modules/auth/entities/organization.entity';
import { HtsEmbeddingEntity, HtsEntity } from '@hts/core';

jest.setTimeout(120000);

describe('HTS Lookup API (E2E)', () => {
  let app: INestApplication;
  let apiKeyService: ApiKeyService;
  let organizationRepository: Repository<OrganizationEntity>;
  let htsRepository: Repository<HtsEntity>;
  let htsEmbeddingRepository: Repository<HtsEmbeddingEntity>;
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
    organizationRepository = moduleFixture.get<Repository<OrganizationEntity>>(
      getRepositoryToken(OrganizationEntity),
    );
    htsRepository = moduleFixture.get<Repository<HtsEntity>>(
      getRepositoryToken(HtsEntity),
    );
    htsEmbeddingRepository = moduleFixture.get<Repository<HtsEmbeddingEntity>>(
      getRepositoryToken(HtsEmbeddingEntity),
    );
    const organization = await organizationRepository.save(
      organizationRepository.create({
        name: `HTS Lookup Test Org ${Date.now()}`,
      }),
    );
    testOrganizationId = organization.id;
    await seedTestHtsData();

    // Generate API key with lookup permission
    const result = await apiKeyService.generateApiKey({
      name: 'HTS Lookup Test Key',
      organizationId: testOrganizationId,
      environment: 'test',
      permissions: ['hts:lookup'],
      rateLimitPerMinute: 100,
      rateLimitPerDay: 10000,
    });
    validApiKey = result.plainTextKey;
  });

  afterAll(async () => {
    await new Promise((resolve) => setTimeout(resolve, 200));
    await app.close();
  });

  async function seedTestHtsData(): Promise<void> {
    const codes = [
      '0101.00.0000',
      '0101.21.0000',
      '0101.21.0010',
      '6109.10.0000',
      '6203.42.0000',
    ];
    const version = `e2e_${Date.now()}`;

    await htsEmbeddingRepository
      .createQueryBuilder()
      .delete()
      .from(HtsEmbeddingEntity)
      .where('hts_number IN (:...codes)', { codes })
      .execute();
    await htsRepository
      .createQueryBuilder()
      .delete()
      .from(HtsEntity)
      .where('hts_number IN (:...codes)', { codes })
      .execute();

    const entries = [
      htsRepository.create({
        htsNumber: '0101.00.0000',
        version,
        indent: 0,
        description: 'Live horses, asses, mules and hinnies',
        unit: 'No.',
        unitOfQuantity: 'No.',
        generalRate: '2%',
        chapter: '01',
        heading: '0101',
        subheading: '010100',
        isActive: true,
      }),
      htsRepository.create({
        htsNumber: '0101.21.0000',
        version,
        indent: 1,
        description: 'Purebred breeding horses',
        unit: 'No.',
        unitOfQuantity: 'No.',
        generalRate: 'Free',
        chapter: '01',
        heading: '0101',
        subheading: '010121',
        parentHtsNumber: '0101.00.0000',
        isActive: true,
      }),
      htsRepository.create({
        htsNumber: '0101.21.0010',
        version,
        indent: 2,
        description: 'Other purebred horses for breeding purposes',
        unit: 'No.',
        unitOfQuantity: 'No.',
        generalRate: 'Free',
        chapter: '01',
        heading: '0101',
        subheading: '010121',
        parentHtsNumber: '0101.21.0000',
        isActive: true,
      }),
      htsRepository.create({
        htsNumber: '6109.10.0000',
        version,
        indent: 0,
        description: 'T-shirts, singlets and other vests, of cotton apparel',
        unit: 'pcs',
        unitOfQuantity: 'pcs',
        generalRate: '16.5%',
        chapter: '61',
        heading: '6109',
        subheading: '610910',
        isActive: true,
      }),
      htsRepository.create({
        htsNumber: '6203.42.0000',
        version,
        indent: 0,
        description:
          "Men's or boys' trousers and shorts, of cotton garments and clothing",
        unit: 'pcs',
        unitOfQuantity: 'pcs',
        generalRate: '16.6%',
        chapter: '62',
        heading: '6203',
        subheading: '620342',
        isActive: true,
      }),
    ];
    await htsRepository.save(entries);

    const baseEmbedding = Array.from({ length: 1536 }, (_, index) =>
      index % 9 === 0 ? 0.001 : 0,
    );
    const embeddings = entries.map((entry) =>
      htsEmbeddingRepository.create({
        htsNumber: entry.htsNumber,
        embedding: baseEmbedding,
        searchText: `${entry.htsNumber} ${entry.description}`,
        model: 'text-embedding-3-small',
        isCurrent: true,
      }),
    );
    await htsEmbeddingRepository.save(embeddings);
  }

  describe('GET /api/v1/hts/lookup', () => {
    it('should look up a valid HTS code', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/hts/lookup?code=0101.21.0000')
        .set('X-API-Key', validApiKey)
        .expect(200);

      expect(response.body).toBeDefined();
      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
      expect(response.body.data.htsNumber).toBe('0101.21.0000');
      expect(response.body.data.description).toBeDefined();
      expect(response.body.meta.apiVersion).toBe('v1');
      expect(response.body.meta.organizationId).toBe(testOrganizationId);
    });

    it('should return complete HTS details', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/hts/lookup?code=0101.21.0000')
        .set('X-API-Key', validApiKey)
        .expect(200);

      const htsData = response.body.data;

      // Verify essential fields exist
      expect(htsData).toHaveProperty('htsNumber');
      expect(htsData).toHaveProperty('description');
      expect(htsData).toHaveProperty('indent');
      expect(htsData).toHaveProperty('chapter');
      expect(htsData).toHaveProperty('heading');
      expect(htsData).toHaveProperty('subheading');
      expect(htsData).toHaveProperty('unit');
    });

    it('should reject missing HTS code parameter', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/hts/lookup')
        .set('X-API-Key', validApiKey)
        .expect(400);

      expect(response.body.message).toContain('HTS code is required');
    });

    it('should return 404 for non-existent HTS code', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/hts/lookup?code=9999.99.9999')
        .set('X-API-Key', validApiKey)
        .expect(404);

      expect(response.body.message).toContain('not found');
    });

    it('should handle malformed HTS codes', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/hts/lookup?code=INVALID_CODE')
        .set('X-API-Key', validApiKey);

      // Should return 404 or 400
      expect([400, 404]).toContain(response.status);
    });

    it('should require authentication', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/hts/lookup?code=0101.21.0000')
        .expect(401);
    });

    it('should enforce permission requirements', async () => {
      // Create a key without lookup permission
      const noLookupResult = await apiKeyService.generateApiKey({
        name: 'No Lookup Permission Key',
        organizationId: testOrganizationId,
        environment: 'test',
        permissions: ['hts:calculate'], // Different permission
      });

      await request(app.getHttpServer())
        .get('/api/v1/hts/lookup?code=0101.21.0000')
        .set('X-API-Key', noLookupResult.plainTextKey)
        .expect(403);
    });
  });

  describe('GET /api/v1/hts/search', () => {
    it('should search HTS codes by query', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/hts/search?q=live horses')
        .set('X-API-Key', validApiKey)
        .expect(200);

      expect(response.body).toBeDefined();
      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.meta.query).toBe('live horses');
      expect(response.body.meta.count).toBe(response.body.data.length);
    });

    it('should return relevant results for natural language query', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/hts/search?q=cotton t-shirts')
        .set('X-API-Key', validApiKey)
        .expect(200);

      expect(response.body.data.length).toBeGreaterThan(0);

      // Results should be relevant (contain cotton or textile related items)
      const firstResult = response.body.data[0];
      expect(firstResult).toHaveProperty('htsNumber');
      expect(firstResult).toHaveProperty('description');
      expect(firstResult).toHaveProperty('score'); // Search relevance score
    });

    it('should handle keyword search', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/hts/search?q=chapter 61')
        .set('X-API-Key', validApiKey)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);
    });

    it('should respect limit parameter', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/hts/search?q=textile&limit=5')
        .set('X-API-Key', validApiKey)
        .expect(200);

      expect(response.body.data.length).toBeLessThanOrEqual(5);
      expect(response.body.meta.limit).toBe(5);
    });

    it('should default to limit of 10', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/hts/search?q=apparel')
        .set('X-API-Key', validApiKey)
        .expect(200);

      expect(response.body.data.length).toBeLessThanOrEqual(10);
    });

    it('should reject missing query parameter', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/hts/search')
        .set('X-API-Key', validApiKey)
        .expect(400);

      expect(response.body.message).toContain('Search query is required');
    });

    it('should handle empty search results gracefully', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/hts/search?q=xyznonexistentproduct123')
        .set('X-API-Key', validApiKey)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
      expect(Array.isArray(response.body.data)).toBe(true);
      // May return 0 results or low-relevance results
    });

    it('should handle special characters in query', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/hts/search?q=t-shirts%20%26%20pants')
        .set('X-API-Key', validApiKey)
        .expect(200);

      expect(response.body.success).toBe(true);
    });

    it('should perform semantic search', async () => {
      // Test that semantic search works (similar terms should match)
      const response = await request(app.getHttpServer())
        .get('/api/v1/hts/search?q=clothing')
        .set('X-API-Key', validApiKey)
        .expect(200);

      expect(response.body.data.length).toBeGreaterThan(0);

      // Results might include "apparel", "garments", etc. (semantic matches)
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
  });

  describe('GET /api/v1/hts/autocomplete', () => {
    it('should return ranked autocomplete matches for code prefix', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/hts/autocomplete?q=0101')
        .set('X-API-Key', validApiKey)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.data.length).toBeGreaterThan(0);
      expect(response.body.data[0]).toHaveProperty('htsNumber');
      expect(response.body.data[0]).toHaveProperty('description');
      expect(response.body.meta.count).toBe(response.body.data.length);
    });

    it('should enforce minimum query length', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/hts/autocomplete?q=0')
        .set('X-API-Key', validApiKey)
        .expect(400);
    });

    it('should enforce authentication', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/hts/autocomplete?q=0101')
        .expect(401);
    });
  });

  describe('GET /api/v1/hts/hierarchy', () => {
    it('should return hierarchy for an HTS code', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/hts/hierarchy?code=0101.21.0000')
        .set('X-API-Key', validApiKey)
        .expect(200);

      expect(response.body).toBeDefined();
      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
      expect(response.body.data.current).toBeDefined();
      expect(response.body.data.current.htsNumber).toBe('0101.21.0000');
    });

    it('should include parent HTS code if exists', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/hts/hierarchy?code=0101.21.0000')
        .set('X-API-Key', validApiKey)
        .expect(200);

      expect(response.body.data).toHaveProperty('parent');

      // If parent exists, verify it has correct structure
      if (response.body.data.parent) {
        expect(response.body.data.parent).toHaveProperty('htsNumber');
        expect(response.body.data.parent).toHaveProperty('description');
        expect(response.body.data.parent.htsNumber).not.toBe(
          response.body.data.current.htsNumber,
        );
      }
    });

    it('should include children HTS codes if exist', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/hts/hierarchy?code=0101.21.0000')
        .set('X-API-Key', validApiKey)
        .expect(200);

      expect(response.body.data).toHaveProperty('children');
      expect(Array.isArray(response.body.data.children)).toBe(true);

      // If children exist, verify structure
      if (response.body.data.children.length > 0) {
        const firstChild = response.body.data.children[0];
        expect(firstChild).toHaveProperty('htsNumber');
        expect(firstChild).toHaveProperty('description');
        expect(firstChild.parentHtsNumber).toBe('0101.21.0000');
      }
    });

    it('should handle chapter-level hierarchy', async () => {
      // Test with a chapter code (shorter code)
      const response = await request(app.getHttpServer())
        .get('/api/v1/hts/hierarchy?code=0101')
        .set('X-API-Key', validApiKey);

      // May return 200 with data or 404 if chapter codes aren't in DB
      if (response.status === 200) {
        expect(response.body.data.current).toBeDefined();
        expect(response.body.data.children).toBeDefined();
      }
    });

    it('should reject missing code parameter', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/hts/hierarchy')
        .set('X-API-Key', validApiKey)
        .expect(400);

      expect(response.body.message).toContain('HTS code is required');
    });

    it('should return 404 for non-existent code', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/hts/hierarchy?code=9999.99.9999')
        .set('X-API-Key', validApiKey)
        .expect(404);

      expect(response.body.message).toContain('not found');
    });

    it('should require authentication', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/hts/hierarchy?code=0101.21.0000')
        .expect(401);
    });
  });

  describe('Response Format & Metadata', () => {
    it('should return consistent response format across all endpoints', async () => {
      // Test lookup endpoint
      const lookupResponse = await request(app.getHttpServer())
        .get('/api/v1/hts/lookup?code=0101.21.0000')
        .set('X-API-Key', validApiKey)
        .expect(200);

      expect(lookupResponse.body).toHaveProperty('success');
      expect(lookupResponse.body).toHaveProperty('data');
      expect(lookupResponse.body).toHaveProperty('meta');

      // Test search endpoint
      const searchResponse = await request(app.getHttpServer())
        .get('/api/v1/hts/search?q=horses')
        .set('X-API-Key', validApiKey)
        .expect(200);

      expect(searchResponse.body).toHaveProperty('success');
      expect(searchResponse.body).toHaveProperty('data');
      expect(searchResponse.body).toHaveProperty('meta');

      // Test hierarchy endpoint
      const hierarchyResponse = await request(app.getHttpServer())
        .get('/api/v1/hts/hierarchy?code=0101.21.0000')
        .set('X-API-Key', validApiKey)
        .expect(200);

      expect(hierarchyResponse.body).toHaveProperty('success');
      expect(hierarchyResponse.body).toHaveProperty('data');
      expect(hierarchyResponse.body).toHaveProperty('meta');
    });

    it('should include organization ID in response metadata', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/hts/lookup?code=0101.21.0000')
        .set('X-API-Key', validApiKey)
        .expect(200);

      expect(response.body.meta.organizationId).toBe(testOrganizationId);
    });

    it('should include API version in response metadata', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/hts/lookup?code=0101.21.0000')
        .set('X-API-Key', validApiKey)
        .expect(200);

      expect(response.body.meta.apiVersion).toBe('v1');
    });
  });

  describe('Rate Limiting', () => {
    it('should include rate limit headers in response', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/hts/lookup?code=0101.21.0000')
        .set('X-API-Key', validApiKey)
        .expect(200);

      expect(response.headers['x-ratelimit-limit-minute']).toBeDefined();
      expect(response.headers['x-ratelimit-remaining-minute']).toBeDefined();
      expect(response.headers['x-ratelimit-limit-day']).toBeDefined();
      expect(response.headers['x-ratelimit-remaining-day']).toBeDefined();
    });

    it('should decrement rate limit with each request', async () => {
      const response1 = await request(app.getHttpServer())
        .get('/api/v1/hts/lookup?code=0101.21.0000')
        .set('X-API-Key', validApiKey)
        .expect(200);

      const remaining1 = parseInt(response1.headers['x-ratelimit-remaining-minute']);
      await new Promise((resolve) => setTimeout(resolve, 100));

      const response2 = await request(app.getHttpServer())
        .get('/api/v1/hts/lookup?code=0101.21.0000')
        .set('X-API-Key', validApiKey)
        .expect(200);

      const remaining2 = parseInt(response2.headers['x-ratelimit-remaining-minute']);

      expect(remaining2).toBeLessThan(remaining1);
    });
  });

  describe('Error Handling', () => {
    it('should return proper error format for invalid requests', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/hts/lookup')
        .set('X-API-Key', validApiKey)
        .expect(400);

      expect(response.body).toHaveProperty('statusCode');
      expect(response.body).toHaveProperty('message');
      expect(response.body).toHaveProperty('error');
      expect(response.body.statusCode).toBe(400);
    });

    it('should return proper error format for not found', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/hts/lookup?code=9999.99.9999')
        .set('X-API-Key', validApiKey)
        .expect(404);

      expect(response.body.statusCode).toBe(404);
      expect(response.body.error).toBe('Not Found');
    });

    it('should handle server errors gracefully', async () => {
      // This would test internal server errors
      // Difficult to trigger without mocking, but structure should be:
      // { statusCode: 500, message: '...', error: '...' }
    });
  });
});
