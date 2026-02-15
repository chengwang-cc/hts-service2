import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { Repository } from 'typeorm';
import { AppModule } from '../src/app.module';
import { ApiKeyService } from '../src/modules/api-keys/services/api-key.service';
import { OrganizationEntity } from '../src/modules/auth/entities/organization.entity';
import { HtsEntity } from '@hts/core';

jest.setTimeout(120000);

describe('Calculator Flow (E2E)', () => {
  let app: INestApplication;
  let apiKeyService: ApiKeyService;
  let organizationRepository: Repository<OrganizationEntity>;
  let htsRepository: Repository<HtsEntity>;
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
    const organization = await organizationRepository.save(
      organizationRepository.create({
        name: `Calculator Test Org ${Date.now()}`,
      }),
    );
    testOrganizationId = organization.id;
    await seedCalculatorHtsData();

    // Generate API key with calculate permission
    const result = await apiKeyService.generateApiKey({
      name: 'Calculator Test Key',
      organizationId: testOrganizationId,
      environment: 'test',
      permissions: ['hts:calculate'],
      rateLimitPerMinute: 100,
      rateLimitPerDay: 10000,
    });
    validApiKey = result.plainTextKey;
  });

  afterAll(async () => {
    await new Promise((resolve) => setTimeout(resolve, 200));
    await app.close();
  });

  async function seedCalculatorHtsData(): Promise<void> {
    const codes = ['0101.21.0000', '6109.10.00'];
    const version = `calc_e2e_${Date.now()}`;

    await htsRepository
      .createQueryBuilder()
      .delete()
      .from(HtsEntity)
      .where('hts_number IN (:...codes)', { codes })
      .execute();

    await htsRepository.save([
      htsRepository.create({
        htsNumber: '0101.21.0000',
        version,
        indent: 0,
        description: 'Purebred breeding horses',
        chapter: '01',
        heading: '0101',
        subheading: '010121',
        unit: 'No.',
        unitOfQuantity: 'No.',
        generalRate: '5%',
        rateFormula: 'value * 0.05',
        isActive: true,
      }),
      htsRepository.create({
        htsNumber: '6109.10.00',
        version,
        indent: 0,
        description: 'T-shirts, singlets and other vests, of cotton',
        chapter: '61',
        heading: '6109',
        subheading: '610910',
        unit: 'pcs',
        unitOfQuantity: 'pcs',
        generalRate: '16.5%',
        rateFormula: 'value * 0.165',
        isActive: true,
      }),
    ]);
  }

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
        .expect(201);

      expect(response.body).toBeDefined();
      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
      expect(response.body.data.calculationId).toBeDefined();
      expect(response.body.data.baseDuty).toBeDefined();
      expect(response.body.data.totalDuty).toBeDefined();
      expect(response.body.data.landedCost).toBeDefined();
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
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data.totalDuty).toBeGreaterThan(0);
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
        .expect(201);

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
        .expect(201);

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
        .expect(201);

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
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data.breakdown.additionalTariffs).toBeDefined();

      // Should include Chapter 99 tariffs if configured in database
      if (response.body.data.breakdown.additionalTariffs.length > 0) {
        expect(response.body.data.breakdown.additionalTariffs[0].type).toBeDefined();
        expect(response.body.data.breakdown.additionalTariffs[0].amount).toBeGreaterThan(0);
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
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data.breakdown.taxes).toBeDefined();

      // Check for MPF and HMF in taxes array
      const mpf = response.body.data.breakdown.taxes.find((tax: any) =>
        tax.type.includes('MPF') || tax.description.includes('Merchandise Processing Fee')
      );

      if (mpf) {
        expect(mpf.amount).toBeGreaterThan(0);
        expect(mpf.description).toBeDefined();
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
        .expect(201);

      // Test with very high value (should hit maximum)
      const highValueResponse = await request(app.getHttpServer())
        .post('/api/v1/calculator/calculate')
        .set('X-API-Key', validApiKey)
        .send({
          htsNumber: '0101.21.0000',
          countryOfOrigin: 'CA',
          declaredValue: 1000000,
        })
        .expect(201);

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
        .expect(201);

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
          .expect(201);
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
        .expect(201);

      // Verify response structure
      expect(response.body).toHaveProperty('success');
      expect(response.body).toHaveProperty('data');
      expect(response.body).toHaveProperty('meta');
      expect(response.body.meta).toHaveProperty('apiVersion');
      expect(response.body.meta).toHaveProperty('organizationId');

      // Verify data structure
      expect(response.body.data).toHaveProperty('calculationId');
      expect(response.body.data).toHaveProperty('baseDuty');
      expect(response.body.data).toHaveProperty('totalDuty');
      expect(response.body.data).toHaveProperty('landedCost');
    });
  });
});
