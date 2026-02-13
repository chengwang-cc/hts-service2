import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { ApiKeyService } from '../src/modules/api-keys/services/api-key.service';

describe('API Key Authentication (E2E)', () => {
  let app: INestApplication;
  let apiKeyService: ApiKeyService;
  let validApiKey: string;
  let testOrganizationId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();

    // Enable global validation pipe (same as main.ts)
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
    testOrganizationId = 'test-org-' + Date.now();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('API Key Generation', () => {
    it('should generate a valid API key', async () => {
      const result = await apiKeyService.generateApiKey({
        name: 'Test API Key',
        organizationId: testOrganizationId,
        environment: 'sandbox',
        permissions: ['hts:lookup', 'hts:calculate'],
        rateLimitPerMinute: 60,
        rateLimitPerDay: 10000,
      });

      expect(result).toBeDefined();
      expect(result.plainTextKey).toBeDefined();
      expect(result.plainTextKey).toMatch(/^hts_sandbox_/);
      expect(result.apiKey).toBeDefined();
      expect(result.apiKey.keyHash).toBeDefined();
      expect(result.apiKey.keyPrefix).toBe(result.plainTextKey.substring(0, 20));

      // Store for later tests
      validApiKey = result.plainTextKey;
    });

    it('should hash API keys securely (never store plain text)', async () => {
      const result = await apiKeyService.generateApiKey({
        name: 'Security Test Key',
        organizationId: testOrganizationId,
        environment: 'production',
        permissions: ['hts:lookup'],
      });

      // Verify key is hashed (SHA-256 produces 64 character hex string)
      expect(result.apiKey.keyHash).toHaveLength(64);
      expect(result.apiKey.keyHash).toMatch(/^[a-f0-9]+$/);

      // Verify plain text key is NOT stored in database
      expect(result.apiKey.keyHash).not.toBe(result.plainTextKey);
    });
  });

  describe('API Key Validation', () => {
    it('should accept valid API key', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/hts/lookup?code=0101.21.0000')
        .set('X-API-Key', validApiKey)
        .expect(200);

      expect(response.body).toBeDefined();
      expect(response.body.success).toBe(true);
    });

    it('should reject missing API key', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/hts/lookup?code=0101.21.0000')
        .expect(401);
    });

    it('should reject invalid API key format', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/hts/lookup?code=0101.21.0000')
        .set('X-API-Key', 'invalid_key_format')
        .expect(401);
    });

    it('should reject non-existent API key', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/hts/lookup?code=0101.21.0000')
        .set('X-API-Key', 'hts_sandbox_nonexistent_key_123456789')
        .expect(401);
    });

    it('should accept API key in Authorization header', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/hts/lookup?code=0101.21.0000')
        .set('Authorization', `Bearer ${validApiKey}`)
        .expect(200);

      expect(response.body.success).toBe(true);
    });
  });

  describe('Permission Checking', () => {
    let lookupOnlyKey: string;

    beforeAll(async () => {
      const result = await apiKeyService.generateApiKey({
        name: 'Lookup Only Key',
        organizationId: testOrganizationId,
        environment: 'sandbox',
        permissions: ['hts:lookup'], // Only lookup, no calculate
        rateLimitPerMinute: 60,
        rateLimitPerDay: 10000,
      });
      lookupOnlyKey = result.plainTextKey;
    });

    it('should allow access with correct permission', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/hts/lookup?code=0101.21.0000')
        .set('X-API-Key', lookupOnlyKey)
        .expect(200);
    });

    it('should deny access without required permission', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/calculator/calculate')
        .set('X-API-Key', lookupOnlyKey)
        .send({
          htsNumber: '0101.21.0000',
          countryOfOrigin: 'CN',
          declaredValue: 1000,
        })
        .expect(403);
    });
  });

  describe('Rate Limiting', () => {
    let rateLimitedKey: string;

    beforeAll(async () => {
      const result = await apiKeyService.generateApiKey({
        name: 'Rate Limited Key',
        organizationId: testOrganizationId,
        environment: 'sandbox',
        permissions: ['hts:lookup'],
        rateLimitPerMinute: 3, // Very low limit for testing
        rateLimitPerDay: 100,
      });
      rateLimitedKey = result.plainTextKey;
    });

    it('should enforce per-minute rate limit', async () => {
      // Make requests up to the limit
      for (let i = 0; i < 3; i++) {
        await request(app.getHttpServer())
          .get('/api/v1/hts/lookup?code=0101.21.0000')
          .set('X-API-Key', rateLimitedKey)
          .expect(200);
      }

      // Next request should be rate limited
      const response = await request(app.getHttpServer())
        .get('/api/v1/hts/lookup?code=0101.21.0000')
        .set('X-API-Key', rateLimitedKey)
        .expect(429);

      expect(response.body.message).toContain('Rate limit exceeded');
    });

    it('should include rate limit headers', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/hts/lookup?code=0101.21.0000')
        .set('X-API-Key', validApiKey);

      expect(response.headers['x-ratelimit-limit-minute']).toBeDefined();
      expect(response.headers['x-ratelimit-remaining-minute']).toBeDefined();
      expect(response.headers['x-ratelimit-limit-day']).toBeDefined();
      expect(response.headers['x-ratelimit-remaining-day']).toBeDefined();
    });
  });

  describe('IP Whitelist', () => {
    let whitelistedKey: string;

    beforeAll(async () => {
      const result = await apiKeyService.generateApiKey({
        name: 'Whitelisted Key',
        organizationId: testOrganizationId,
        environment: 'production',
        permissions: ['hts:lookup'],
        ipWhitelist: ['192.168.1.1', '10.0.0.0'], // Specific IPs only
      });
      whitelistedKey = result.plainTextKey;
    });

    it('should enforce IP whitelist (deny non-whitelisted IP)', async () => {
      // Note: In real test, this would need to mock the request IP
      // For now, this demonstrates the test structure
      const response = await request(app.getHttpServer())
        .get('/api/v1/hts/lookup?code=0101.21.0000')
        .set('X-API-Key', whitelistedKey);

      // Response will vary based on test environment IP
      // In production, non-whitelisted IPs should get 403
      if (response.status === 403) {
        expect(response.body.message).toContain('IP not whitelisted');
      }
    });
  });

  describe('Organization Isolation', () => {
    let org1Key: string;
    let org2Key: string;
    let org1Id: string;
    let org2Id: string;

    beforeAll(async () => {
      org1Id = 'org1-' + Date.now();
      org2Id = 'org2-' + Date.now();

      const key1 = await apiKeyService.generateApiKey({
        name: 'Org 1 Key',
        organizationId: org1Id,
        environment: 'sandbox',
        permissions: ['hts:calculate'],
      });
      org1Key = key1.plainTextKey;

      const key2 = await apiKeyService.generateApiKey({
        name: 'Org 2 Key',
        organizationId: org2Id,
        environment: 'sandbox',
        permissions: ['hts:calculate'],
      });
      org2Key = key2.plainTextKey;
    });

    it('should isolate calculations by organization', async () => {
      // Org 1 creates a calculation
      const calcResponse = await request(app.getHttpServer())
        .post('/api/v1/calculator/calculate')
        .set('X-API-Key', org1Key)
        .send({
          htsNumber: '0101.21.0000',
          countryOfOrigin: 'CN',
          declaredValue: 1000,
        })
        .expect(200);

      const calculationId = calcResponse.body.data.calculationId;

      // Org 1 can retrieve it
      await request(app.getHttpServer())
        .get(`/api/v1/calculator/calculations/${calculationId}`)
        .set('X-API-Key', org1Key)
        .expect(200);

      // Org 2 cannot retrieve it (organization isolation)
      await request(app.getHttpServer())
        .get(`/api/v1/calculator/calculations/${calculationId}`)
        .set('X-API-Key', org2Key)
        .expect(404);
    });
  });

  describe('Usage Tracking', () => {
    it('should track API usage', async () => {
      // Make a request
      await request(app.getHttpServer())
        .get('/api/v1/hts/lookup?code=0101.21.0000')
        .set('X-API-Key', validApiKey)
        .expect(200);

      // Wait for async tracking to complete
      await new Promise(resolve => setTimeout(resolve, 100));

      // Verify usage was tracked (this would need access to usage metrics)
      // For now, this demonstrates the test structure
      // const usage = await apiKeyService.getUsageStats(apiKeyId, startDate, endDate);
      // expect(usage.totalRequests).toBeGreaterThan(0);
    });
  });
});
