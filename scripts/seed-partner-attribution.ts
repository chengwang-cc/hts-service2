/**
 * Idempotent seed for partner attribution rows.
 *
 *   - chitchats              (partner)   origins: *.chitchats.com
 *   - proto-ecommerce        (partner)   origins: *.proto.com, *.hts.proto.com
 *   - usahts-internal        (internal)  origins: *.usahts.com
 *   - unknown                (customer)  origins: none — sentinel fallback
 *
 * Re-running this updates existing rows by `slug` and re-applies origin rules.
 *
 * Usage: npx ts-node -P ./tsconfig.json -r tsconfig-paths/register scripts/seed-partner-attribution.ts
 */
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import * as dotenv from 'dotenv';
import { OrganizationEntity, OrganizationType } from '../src/modules/auth/entities/organization.entity';
import { PartnerOriginEntity } from '../src/modules/partner-attribution/entities/partner-origin.entity';
import { CustomNamingStrategy } from '../src/configs/custom-naming.strategy';

dotenv.config();

interface PartnerSeed {
  slug: string;
  name: string;
  type: OrganizationType;
  origins: string[];
}

const PARTNERS: PartnerSeed[] = [
  {
    slug: 'chitchats',
    name: 'ChitChats',
    type: 'partner',
    origins: ['*.chitchats.com'],
  },
  {
    slug: 'proto-ecommerce',
    name: 'Proto Ecommerce',
    type: 'partner',
    origins: ['*.proto.com'],
  },
  {
    slug: 'usahts-internal',
    name: 'USAHTS (Internal)',
    type: 'internal',
    origins: ['*.usahts.com'],
  },
  {
    slug: 'unknown',
    name: 'Unknown Partner (catch-all)',
    type: 'customer',
    origins: [],
  },
];

async function main(): Promise<void> {
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
    entities: [OrganizationEntity, PartnerOriginEntity],
    synchronize: false,
    namingStrategy: new CustomNamingStrategy(),
  });

  await ds.initialize();
  console.log('Connected to DB.');

  const orgRepo = ds.getRepository(OrganizationEntity);
  const originRepo = ds.getRepository(PartnerOriginEntity);

  for (const p of PARTNERS) {
    let org = await orgRepo.findOne({ where: { slug: p.slug } });
    if (!org) {
      org = await orgRepo.save({
        slug: p.slug,
        name: p.name,
        type: p.type,
        plan: 'FREE',
        isActive: true,
      });
      console.log(`+ created organization: ${p.slug} (${org.id})`);
    } else {
      const before = { name: org.name, type: org.type };
      org.name = p.name;
      org.type = p.type;
      org.isActive = true;
      await orgRepo.save(org);
      const changed = JSON.stringify(before) !== JSON.stringify({ name: p.name, type: p.type });
      console.log(`= ${changed ? 'updated' : 'exists'}  organization: ${p.slug} (${org.id})`);
    }

    // Sync origins: delete missing, insert new. Keeps reapplies idempotent.
    const existing = await originRepo.find({ where: { organizationId: org.id } });
    const existingByPattern = new Map(existing.map((e) => [e.originPattern, e]));
    const want = new Set(p.origins);

    for (const pattern of p.origins) {
      if (!existingByPattern.has(pattern)) {
        await originRepo.save({
          organizationId: org.id,
          originPattern: pattern,
          purpose: 'web',
          isActive: true,
        });
        console.log(`  + origin: ${pattern}`);
      } else {
        const row = existingByPattern.get(pattern)!;
        if (!row.isActive) {
          row.isActive = true;
          await originRepo.save(row);
          console.log(`  ~ origin: ${pattern} (re-activated)`);
        }
      }
    }
    for (const row of existing) {
      if (!want.has(row.originPattern) && row.isActive) {
        row.isActive = false;
        await originRepo.save(row);
        console.log(`  - origin: ${row.originPattern} (deactivated)`);
      }
    }
  }

  await ds.destroy();
  console.log('Seed complete.');
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
