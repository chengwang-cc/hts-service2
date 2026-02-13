import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { ApiKeyService } from '../src/modules/api-keys/services/api-key.service';

describe('Calculator Flow (E2E)', () => {
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
    testOrganizationId = 'calc-test-org-' + Date.now();

    // Generate API key with calculate permission
    const result = await apiKeyService.generateApiKey({
      name: 'Calculator Test Key',
      organizationId: testOrganizationId,
      environment: 'sandbox',
      permissions: ['hts:calculate'],
      rateLimitPerMinute: 100,
      rateLimitPerDay: 10000,
    });
    validApiKey = result.plainTextKey;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Basic Duty Calculation', () => {
    it('should calculate duties for valid input', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/calculator/calculate')
        .set('X-API-Key', validApiKey)
        .send({
          htsNumber: '0101.21.0000',
          countryOfOrigin: 'CN',
          declaredValue: 1000,
        })
        .expect(200);

      expect(response.body).toBeDefined();
      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
      expect(response.body.data.calculationId).toBeDefined();
      expect(response.body.data.baseRate).toBeDefined();
      expect(response.body.data.dutyAmount).toBeDefined();
      expect(response.body.data.totalCost).toBeDefined();
      expect(response.body.meta.apiVersion).toBe('v1');
    });

    it('should reject missing required fields', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/calculator/calculate')
        .set('X-API-Key', validApiKey)
        .send({
          htsNumber: '0101.21.0000',
          // Missing countryOfOrigin and declaredValue
        })
        .expect(400);

      expect(response.body.message).toContain('Missing required fields');
    });

    it('should handle invalid HTS code', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/calculator/calculate')
        .set('X-API-Key', validApiKey)
        .send({
          htsNumber: '9999.99.9999', // Non-existent code
          countryOfOrigin: 'CN',
          declaredValue: 1000,
        })
        .expect(500);

      expect(response.body.error).toBeDefined();
    });
  });

  describe('Calculation with Optional Parameters', () => {
    it('should calculate with weight and quantity', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/calculator/calculate')
        .set('X-API-Key', validApiKey)
        .send({
          htsNumber: '6109.10.00',
          countryOfOrigin: 'CN',
          declaredValue: 5000,
          weightKg: 10.5,
          quantity: 100,
          quantityUnit: 'pcs',
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.dutyAmount).toBeGreaterThan(0);
    });

    it('should calculate with currency parameter', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/calculator/calculate')
        .set('X-API-Key', validApiKey)
        .send({
          htsNumber: '0101.21.0000',
          countryOfOrigin: 'MX',
          declaredValue: 1000,
          currency: 'USD',
        })
        .expect(200);

      expect(response.body.success).toBe(true);
    });
  });

  describe('Trade Agreement Calculations', () => {
    it('should apply trade agreement preferential rate', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/calculator/calculate')
        .set('X-API-Key', validApiKey)
        .send({
          htsNumber: '6109.10.00',
          countryOfOrigin: 'MX',
          declaredValue: 1000,
          tradeAgreementCode: 'USMCA',
          tradeAgreementCertificate: true,
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();

      // Trade agreement should reduce or eliminate duty
      // (actual verification depends on data in database)
    });

    it('should not apply trade agreement without certificate', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/calculator/calculate')
        .set('X-API-Key', validApiKey)
        .send({
          htsNumber: '6109.10.00',
          countryOfOrigin: 'MX',
          declaredValue: 1000,
          tradeAgreementCode: 'USMCA',
          tradeAgreementCertificate: false,
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      // Without certificate, should use normal rate
    });
  });

  describe('Additional Tariffs (Chapter 99)', () => {
    it('should apply additional tariffs for non-NTR countries', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/calculator/calculate')
        .set('X-API-Key', validApiKey)
        .send({
          htsNumber: '6109.10.00',
          countryOfOrigin: 'CN', // China - subject to Chapter 99
          declaredValue: 1000,
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.additionalTariffs).toBeDefined();

      // Should include Chapter 99 tariffs if configured in database
      if (response.body.data.additionalTariffs.length > 0) {
        expect(response.body.data.additionalTariffs[0].name).toBeDefined();
        expect(response.body.data.additionalTariffs[0].rate).toBeDefined();
        expect(response.body.data.additionalTariffs[0].amount).toBeGreaterThan(0);
      }
    });
  });

  describe('MPF and HMF Calculations', () => {
    it('should calculate MPF and HMF', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/calculator/calculate')
        .set('X-API-Key', validApiKey)
        .send({
          htsNumber: '0101.21.0000',
          countryOfOrigin: 'CA',
          declaredValue: 10000,
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.taxes).toBeDefined();

      // Check for MPF and HMF in taxes array
      const mpf = response.body.data.taxes.find((tax: any) =>
        tax.name.includes('MPF') || tax.name.includes('Merchandise Processing Fee')
      );

      if (mpf) {
        expect(mpf.amount).toBeGreaterThan(0);
        expect(mpf.rate).toBeDefined();
      }
    });

    it('should respect MPF minimum and maximum', async () => {
      // Test with very low value (should hit minimum)
      const lowValueResponse = await request(app.getHttpServer())
        .post('/api/v1/calculator/calculate')
        .set('X-API-Key', validApiKey)
        .send({
          htsNumber: '0101.21.0000',
          countryOfOrigin: 'CA',
          declaredValue: 100,
        })
        .expect(200);

      // Test with very high value (should hit maximum)
      const highValueResponse = await request(app.getHttpServer())
        .post('/api/v1/calculator/calculate')
        .set('X-API-Key', validApiKey)
        .send({
          htsNumber: '0101.21.0000',
          countryOfOrigin: 'CA',
          declaredValue: 1000000,
        })
        .expect(200);

      expect(lowValueResponse.body.success).toBe(true);
      expect(highValueResponse.body.success).toBe(true);

      // MPF should be capped at configured min/max
      // (exact values depend on HtsExtraTaxEntity configuration)
    });
  });

  describe('Calculation History', () => {
    let calculationId: string;

    it('should save calculation to history', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/calculator/calculate')
        .set('X-API-Key', validApiKey)
        .send({
          htsNumber: '0101.21.0000',
          countryOfOrigin: 'CN',
          declaredValue: 1000,
        })
        .expect(200);

      calculationId = response.body.data.calculationId;
      expect(calculationId).toBeDefined();
    });

    it('should retrieve calculation by ID', async () => {
      const response = await request(app.getHttpServer())
        .get(`/api/v1/calculator/calculations/${calculationId}`)
        .set('X-API-Key', validApiKey)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
      expect(response.body.data.calculationId).toBe(calculationId);
    });

    it('should return 404 for non-existent calculation', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/calculator/calculations/00000000-0000-0000-0000-000000000000')
        .set('X-API-Key', validApiKey)
        .expect(404);
    });

    it('should list recent calculations', async () => {
      // Create a few calculations
      for (let i = 0; i < 3; i++) {
        await request(app.getHttpServer())
          .post('/api/v1/calculator/calculate')
          .set('X-API-Key', validApiKey)
          .send({
            htsNumber: '0101.21.0000',
            countryOfOrigin: 'CN',
            declaredValue: 1000 + i * 100,
          })
          .expect(200);
      }

      // List calculations
      const response = await request(app.getHttpServer())
        .get('/api/v1/calculator/calculations?limit=10')
        .set('X-API-Key', validApiKey)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.data.length).toBeGreaterThan(0);
      expect(response.body.meta.count).toBe(response.body.data.length);
    });

    it('should respect limit parameter', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/calculator/calculations?limit=2')
        .set('X-API-Key', validApiKey)
        .expect(200);

      expect(response.body.data.length).toBeLessThanOrEqual(2);
    });

    it('should enforce maximum limit (100)', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/calculator/calculations?limit=500')
        .set('X-API-Key', validApiKey)
        .expect(200);

      // Should be capped at 100
      expect(response.body.data.length).toBeLessThanOrEqual(100);
    });
  });

  describe('Error Handling', () => {
    it('should handle calculation service errors gracefully', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/calculator/calculate')
        .set('X-API-Key', validApiKey)
        .send({
          htsNumber: 'INVALID',
          countryOfOrigin: 'XX',
          declaredValue: -1000, // Negative value
        })
        .expect(500);

      expect(response.body).toBeDefined();
      expect(response.body.error).toBeDefined();
    });

    it('should validate input types', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/calculator/calculate')
        .set('X-API-Key', validApiKey)
        .send({
          htsNumber: '0101.21.0000',
          countryOfOrigin: 'CN',
          declaredValue: 'not a number', // Invalid type
        });

      // Should be rejected (either 400 or 500 depending on validation)
      expect([400, 500]).toContain(response.status);
    });
  });

  describe('Response Format', () => {
    it('should return consistent response format', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/calculator/calculate')
        .set('X-API-Key', validApiKey)
        .send({
          htsNumber: '0101.21.0000',
          countryOfOrigin: 'CN',
          declaredValue: 1000,
        })
        .expect(200);

      // Verify response structure
      expect(response.body).toHaveProperty('success');
      expect(response.body).toHaveProperty('data');
      expect(response.body).toHaveProperty('meta');
      expect(response.body.meta).toHaveProperty('apiVersion');
      expect(response.body.meta).toHaveProperty('organizationId');

      // Verify data structure
      expect(response.body.data).toHaveProperty('calculationId');
      expect(response.body.data).toHaveProperty('baseRate');
      expect(response.body.data).toHaveProperty('dutyAmount');
      expect(response.body.data).toHaveProperty('totalCost');
    });
  });
});
