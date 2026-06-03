/**
 * Idempotent provisioning for the Proto e-commerce partner.
 *
 * Creates or updates:
 *   1. organizations row (slug='proto-ecommerce', type='partner', plan='ENTERPRISE')
 *   2. partner_origins rows for *.proto.com
 *   3. effectiveLimits synced from the ENTERPRISE plan
 *   4. One browser-purpose API key with permissions [hts:lookup, hts:calculate]
 *      and allowedOrigins=['https://*.proto.com']
 *
 * Re-running is safe:
 *   - Org and origins are upserted by slug / pattern.
 *   - Limits are re-synced (cheap).
 *   - API key is NOT regenerated. If one exists for this org with name
 *     'proto-storefront', the script prints a notice and leaves it alone.
 *     Pass --rotate-key to force a new key.
 *
 * Usage:
 *   npx ts-node -P ./tsconfig.json -r tsconfig-paths/register scripts/seed-proto-partner.ts
 *   npx ts-node -P ./tsconfig.json -r tsconfig-paths/register scripts/seed-proto-partner.ts --rotate-key
 */
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import * as crypto from 'crypto';
import * as dotenv from 'dotenv';
import { OrganizationEntity } from '../src/modules/auth/entities/organization.entity';
import { PartnerOriginEntity } from '../src/modules/partner-attribution/entities/partner-origin.entity';
import { ApiKeyEntity } from '../src/modules/api-keys/entities/api-key.entity';
import { computeFromPlan } from '../src/modules/billing/types/effective-limits';
import { CustomNamingStrategy } from '../src/configs/custom-naming.strategy';

dotenv.config();

const SLUG = 'proto-ecommerce';
const NAME = 'Proto Ecommerce';
const PLAN = 'ENTERPRISE';
const API_KEY_NAME = 'proto-storefront';
const ORIGIN_PATTERNS = ['*.proto.com', '*.hts.proto.com'];
const ALLOWED_ORIGINS = ['https://*.proto.com', 'https://*.hts.proto.com'];

async function main(): Promise<void> {
  const rotateKey = process.argv.includes('--rotate-key');

  const ds = new DataSource({
    type: 'postgres',
    host: process.env.DB_HOST ?? 'localhost',
    port: parseInt(process.env.DB_PORT ?? '5432', 10),
    username: process.env.DB_USERNAME ?? 'postgres',
    password: process.env.DB_PASSWORD ?? '',
    database: process.env.DB_DATABASE ?? 'hts',
    ssl:
      process.env.DB_SSL === 'true'
        ? { rejectUnauthorized: false }
        : process.env.NODE_ENV === 'development'
          ? false
          : { rejectUnauthorized: false },
    entities: [OrganizationEntity, PartnerOriginEntity, ApiKeyEntity],
    synchronize: false,
    namingStrategy: new CustomNamingStrategy(),
  });

  await ds.initialize();
  console.log('Connected to DB.');

  const orgRepo = ds.getRepository(OrganizationEntity);
  const originRepo = ds.getRepository(PartnerOriginEntity);
  const apiKeyRepo = ds.getRepository(ApiKeyEntity);

  // 1. Organization
  let org = await orgRepo.findOne({ where: { slug: SLUG } });
  if (!org) {
    org = orgRepo.create({
      slug: SLUG,
      name: NAME,
      type: 'partner',
      plan: PLAN,
      isActive: true,
      settings: {},
      usageQuotas: null,
      currentUsage: null,
    });
    org = await orgRepo.save(org);
    console.log(`✓ Created organization ${org.id} (${SLUG})`);
  } else {
    org.name = NAME;
    org.type = 'partner';
    org.plan = PLAN;
    org.isActive = true;
    org = await orgRepo.save(org);
    console.log(`✓ Updated organization ${org.id} (${SLUG})`);
  }

  // 2. Origins
  for (const pattern of ORIGIN_PATTERNS) {
    const existing = await originRepo.findOne({
      where: { originPattern: pattern, organizationId: org.id },
    });
    if (existing) {
      existing.isActive = true;
      await originRepo.save(existing);
      console.log(`✓ Origin already registered: ${pattern}`);
    } else {
      await originRepo.save(
        originRepo.create({
          organizationId: org.id,
          originPattern: pattern,
          purpose: 'web',
          isActive: true,
          notes: 'Proto storefront — seeded by scripts/seed-proto-partner.ts',
        }),
      );
      console.log(`✓ Registered origin: ${pattern}`);
    }
  }

  // 3. effectiveLimits
  const limits = computeFromPlan(PLAN);
  if (!limits) throw new Error(`Unknown plan: ${PLAN}`);
  org.settings = { ...(org.settings ?? {}), effectiveLimits: limits };
  await orgRepo.save(org);
  console.log(
    `✓ Synced effectiveLimits: plan=${limits.plan} perMin=${limits.perMinute} perMonth=${limits.requestsPerMonth}`,
  );

  // 4. API key
  const existingKey = await apiKeyRepo.findOne({
    where: { organizationId: org.id, name: API_KEY_NAME },
  });

  if (existingKey && !rotateKey) {
    console.log(
      `✓ API key '${API_KEY_NAME}' already exists (prefix ${existingKey.keyPrefix}…). Use --rotate-key to regenerate.`,
    );
  } else {
    if (existingKey && rotateKey) {
      existingKey.isActive = false;
      await apiKeyRepo.save(existingKey);
      console.log(`✓ Revoked previous key (id=${existingKey.id})`);
    }
    const randomBytes = crypto.randomBytes(24);
    const plainTextKey = `hts_live_${randomBytes.toString('base64url')}`;
    const keyHash = crypto.createHash('sha256').update(plainTextKey).digest('hex');
    const keyPrefix = plainTextKey.substring(0, 20);
    const created = await apiKeyRepo.save(
      apiKeyRepo.create({
        keyHash,
        keyPrefix,
        name: API_KEY_NAME,
        description: 'Proto storefront key — checkout duty calc + HTS lookup',
        organizationId: org.id,
        environment: 'live',
        purpose: 'browser',
        permissions: ['hts:lookup', 'hts:calculate'],
        rateLimitPerMinute: 120,
        rateLimitPerDay: 100_000,
        isActive: true,
        expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
        ipWhitelist: null,
        allowedOrigins: ALLOWED_ORIGINS,
        metadata: { provisionedBy: 'seed-proto-partner.ts' },
        createdBy: null,
      }),
    );
    console.log(`✓ Issued API key id=${created.id}`);
    console.log('');
    console.log('  ┌─────────────────────────────────────────────────────────────┐');
    console.log('  │  COPY THIS KEY NOW — it will NOT be shown again.           │');
    console.log('  └─────────────────────────────────────────────────────────────┘');
    console.log('');
    console.log(`  ${plainTextKey}`);
    console.log('');
  }

  await ds.destroy();
  console.log('Done.');
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
