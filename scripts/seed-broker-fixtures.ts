/**
 * R6-01..03 — broker platform seed fixtures.
 *
 * Seeds:
 *   - 30 marketplace broker profiles + credentials across countries / services
 *   - 1 broker_client + relationship per broker org (sample business)
 *   - 1 broker_entry + 2 lines + 1 packet per sample client
 *   - 3 org-scoped broker_rules per broker org (one per common ruleType)
 *
 * Usage:
 *   npx ts-node -P ./tsconfig.json -r tsconfig-paths/register scripts/seed-broker-fixtures.ts
 *
 * Idempotent: re-runs match-by-slug for profiles and skip if already seeded.
 */
import 'reflect-metadata';
import { config as loadEnv } from 'dotenv';
loadEnv();
import dataSource from '../src/db/data-source';

interface SeedSummary {
  organizations: number;
  profiles: number;
  clients: number;
  relationships: number;
  entries: number;
  rules: number;
}

const BROKER_FIXTURES: Array<{
  slug: string;
  displayName: string;
  legalName: string;
  countries: string[];
  serviceCategories: string[];
  shipmentModes: string[];
  specialties: string[];
  ports: string[];
}> = [
  { slug: 'pacific-rim-customs', displayName: 'Pacific Rim Customs', legalName: 'Pacific Rim Customs Brokerage LLC', countries: ['CN', 'JP', 'KR', 'TW'], serviceCategories: ['ocean_clearance', 'air_clearance'], shipmentModes: ['ocean', 'air'], specialties: ['electronics', 'auto_parts'], ports: ['LAX', 'LGB'] },
  { slug: 'atlantic-clearance', displayName: 'Atlantic Clearance Co.', legalName: 'Atlantic Clearance Co.', countries: ['DE', 'GB', 'FR', 'IT'], serviceCategories: ['ocean_clearance', 'isf', 'pga'], shipmentModes: ['ocean'], specialties: ['food', 'chemicals'], ports: ['NYC', 'NWK'] },
  { slug: 'tex-mex-trade', displayName: 'TexMex Trade Brokers', legalName: 'TexMex Trade Brokers LP', countries: ['MX'], serviceCategories: ['truck_clearance', 'fda', 'usda'], shipmentModes: ['truck'], specialties: ['produce', 'beverages'], ports: ['LRD', 'ELP'] },
  { slug: 'midwest-rail', displayName: 'Midwest Rail Logistics', legalName: 'Midwest Rail Logistics Inc.', countries: ['CA'], serviceCategories: ['rail_clearance', 'in_bond'], shipmentModes: ['rail'], specialties: ['steel', 'lumber'], ports: ['CHI', 'DET'] },
  { slug: 'gulf-energy-customs', displayName: 'Gulf Energy Customs', legalName: 'Gulf Energy Customs Services LLC', countries: ['VE', 'TT', 'BR'], serviceCategories: ['ocean_clearance', 'epa'], shipmentModes: ['ocean'], specialties: ['petroleum', 'machinery'], ports: ['HOU'] },
  { slug: 'cascade-pharma', displayName: 'Cascade Pharma Clearance', legalName: 'Cascade Pharma Clearance Inc.', countries: ['IN', 'CN'], serviceCategories: ['air_clearance', 'fda'], shipmentModes: ['air'], specialties: ['pharmaceuticals', 'medical_devices'], ports: ['SEA', 'PDX'] },
  { slug: 'rockymtn-textile', displayName: 'Rocky Mountain Textile Brokers', legalName: 'Rocky Mountain Textile Brokers LLC', countries: ['VN', 'BD', 'CN'], serviceCategories: ['ocean_clearance', 'textile_visa'], shipmentModes: ['ocean'], specialties: ['apparel', 'home_textiles'], ports: ['DEN'] },
  { slug: 'great-lakes-auto', displayName: 'Great Lakes Auto Clearance', legalName: 'Great Lakes Auto Clearance Co.', countries: ['CA', 'MX', 'DE'], serviceCategories: ['truck_clearance', 'rail_clearance'], shipmentModes: ['truck', 'rail'], specialties: ['auto_parts', 'vehicles'], ports: ['DET'] },
  { slug: 'border-perishables', displayName: 'Border Perishables Inc.', legalName: 'Border Perishables Inc.', countries: ['MX', 'GT', 'PE'], serviceCategories: ['truck_clearance', 'usda', 'fda'], shipmentModes: ['truck', 'air'], specialties: ['produce', 'flowers'], ports: ['NOG', 'MIA'] },
  { slug: 'cyber-tech-brokers', displayName: 'CyberTech Brokers', legalName: 'CyberTech Brokers Group', countries: ['CN', 'TW', 'MY'], serviceCategories: ['ocean_clearance', 'air_clearance', 'isf'], shipmentModes: ['ocean', 'air'], specialties: ['electronics', 'semiconductors'], ports: ['LAX', 'LGB', 'NYC'] },
  { slug: 'heritage-wine-import', displayName: 'Heritage Wine Imports', legalName: 'Heritage Wine Imports LLC', countries: ['FR', 'IT', 'ES', 'CL', 'AR'], serviceCategories: ['ocean_clearance', 'ttb'], shipmentModes: ['ocean'], specialties: ['alcohol', 'beverages'], ports: ['NYC', 'OAK'] },
  { slug: 'rapid-air-cargo', displayName: 'Rapid Air Cargo Brokers', legalName: 'Rapid Air Cargo Brokers Inc.', countries: ['DE', 'NL', 'BE', 'CN'], serviceCategories: ['air_clearance', 'express'], shipmentModes: ['air'], specialties: ['high_value', 'samples'], ports: ['ORD', 'JFK', 'MIA'] },
  { slug: 'metals-importers', displayName: 'Metals Importers Alliance', legalName: 'Metals Importers Alliance LLC', countries: ['CN', 'TR', 'BR', 'KR'], serviceCategories: ['ocean_clearance', 'section_232'], shipmentModes: ['ocean'], specialties: ['steel', 'aluminum'], ports: ['HOU', 'NOR'] },
  { slug: 'south-shore-customs', displayName: 'South Shore Customs', legalName: 'South Shore Customs Brokers', countries: ['CN', 'VN', 'IN'], serviceCategories: ['ocean_clearance', 'consumer_goods'], shipmentModes: ['ocean'], specialties: ['toys', 'home_goods'], ports: ['SAV', 'CHA'] },
  { slug: 'apex-machinery', displayName: 'Apex Machinery Clearance', legalName: 'Apex Machinery Clearance Co.', countries: ['DE', 'JP', 'IT'], serviceCategories: ['ocean_clearance', 'temporary_admission'], shipmentModes: ['ocean'], specialties: ['heavy_machinery', 'industrial'], ports: ['NYC', 'BAL'] },
  { slug: 'frontier-fda-pros', displayName: 'Frontier FDA Pros', legalName: 'Frontier FDA Pros LLC', countries: ['MX', 'CN', 'IN'], serviceCategories: ['fda', 'pga'], shipmentModes: ['truck', 'ocean'], specialties: ['food_supplements', 'cosmetics'], ports: ['LAX', 'LRD'] },
  { slug: 'gateway-brokers', displayName: 'Gateway Brokers', legalName: 'Gateway Brokers Inc.', countries: ['CA', 'CN', 'KR'], serviceCategories: ['ocean_clearance', 'air_clearance'], shipmentModes: ['ocean', 'air'], specialties: ['consumer_electronics'], ports: ['NYC', 'JFK'] },
  { slug: 'sunset-strip-customs', displayName: 'Sunset Strip Customs', legalName: 'Sunset Strip Customs Brokers', countries: ['CN', 'TH', 'VN'], serviceCategories: ['ocean_clearance', 'isf', 'fda'], shipmentModes: ['ocean'], specialties: ['apparel', 'footwear'], ports: ['LAX', 'LGB'] },
  { slug: 'desert-rose-trade', displayName: 'Desert Rose Trade', legalName: 'Desert Rose Trade Inc.', countries: ['AE', 'SA', 'EG'], serviceCategories: ['ocean_clearance', 'air_clearance'], shipmentModes: ['ocean', 'air'], specialties: ['fragrances', 'jewelry'], ports: ['MIA', 'LAX'] },
  { slug: 'evergreen-lumber', displayName: 'Evergreen Lumber Clearance', legalName: 'Evergreen Lumber Clearance LLC', countries: ['CA', 'RU', 'CL'], serviceCategories: ['ocean_clearance', 'rail_clearance'], shipmentModes: ['ocean', 'rail'], specialties: ['lumber', 'building_materials'], ports: ['SEA', 'TIW'] },
  { slug: 'eastern-seaboard', displayName: 'Eastern Seaboard Brokers', legalName: 'Eastern Seaboard Brokers Inc.', countries: ['IT', 'GR', 'ES'], serviceCategories: ['ocean_clearance', 'pga'], shipmentModes: ['ocean'], specialties: ['olive_oil', 'cheese'], ports: ['NYC', 'BOS'] },
  { slug: 'liberty-customs', displayName: 'Liberty Customs Group', legalName: 'Liberty Customs Group LP', countries: ['CN', 'VN', 'BD', 'IN'], serviceCategories: ['ocean_clearance', 'isf', 'textile_visa'], shipmentModes: ['ocean'], specialties: ['apparel', 'fabric'], ports: ['NYC', 'NWK', 'CHA'] },
  { slug: 'silicon-valley-brokers', displayName: 'Silicon Valley Brokers', legalName: 'Silicon Valley Brokers Inc.', countries: ['TW', 'KR', 'JP'], serviceCategories: ['air_clearance', 'isf'], shipmentModes: ['air'], specialties: ['semiconductors', 'electronics'], ports: ['SFO', 'OAK'] },
  { slug: 'global-medical-brokers', displayName: 'Global Medical Brokers', legalName: 'Global Medical Brokers LLC', countries: ['DE', 'CH', 'IL'], serviceCategories: ['air_clearance', 'fda'], shipmentModes: ['air'], specialties: ['medical_devices', 'biotech'], ports: ['JFK', 'BOS'] },
  { slug: 'pacific-flora-imports', displayName: 'Pacific Flora Imports', legalName: 'Pacific Flora Imports Co.', countries: ['CO', 'EC', 'CR'], serviceCategories: ['air_clearance', 'usda'], shipmentModes: ['air'], specialties: ['flowers', 'plants'], ports: ['MIA', 'LAX'] },
  { slug: 'wholesale-brokers-us', displayName: 'Wholesale Brokers USA', legalName: 'Wholesale Brokers USA Inc.', countries: ['CN', 'VN', 'TH'], serviceCategories: ['ocean_clearance', 'consolidation'], shipmentModes: ['ocean'], specialties: ['retail_packaged'], ports: ['LAX', 'NYC', 'HOU'] },
  { slug: 'great-plains-grain', displayName: 'Great Plains Grain Brokers', legalName: 'Great Plains Grain Brokers LLC', countries: ['CA', 'AU', 'AR'], serviceCategories: ['rail_clearance', 'truck_clearance', 'usda'], shipmentModes: ['rail', 'truck'], specialties: ['grain', 'agricultural'], ports: ['CHI', 'KCY'] },
  { slug: 'startup-broker-co', displayName: 'Startup Broker Co.', legalName: 'Startup Broker Co.', countries: ['DE', 'NL', 'GB'], serviceCategories: ['air_clearance', 'express'], shipmentModes: ['air'], specialties: ['samples', 'high_value'], ports: ['JFK', 'ORD'] },
  { slug: 'national-customs-svc', displayName: 'National Customs Service', legalName: 'National Customs Service Inc.', countries: ['CN', 'MX', 'CA', 'JP'], serviceCategories: ['ocean_clearance', 'truck_clearance', 'rail_clearance', 'air_clearance'], shipmentModes: ['ocean', 'truck', 'rail', 'air'], specialties: ['multi_modal'], ports: ['LAX', 'NYC', 'CHI', 'HOU'] },
  { slug: 'boutique-luxury-trade', displayName: 'Boutique Luxury Trade', legalName: 'Boutique Luxury Trade Inc.', countries: ['IT', 'FR', 'CH'], serviceCategories: ['air_clearance', 'high_value'], shipmentModes: ['air'], specialties: ['fashion', 'watches', 'jewelry'], ports: ['JFK', 'MIA'] },
];

const RULE_FIXTURES = [
  {
    code: 'org-pga-fda-required',
    title: 'FDA filing required for chapter 21 imports',
    ruleType: 'pga_required',
    severity: 'blocker',
    config: { chapter: '21', program: 'FDA' },
  },
  {
    code: 'org-coo-required',
    title: 'Country of origin required on every line',
    ruleType: 'required_field',
    severity: 'blocker',
    config: { field: 'countryOfOrigin' },
  },
  {
    code: 'org-value-sanity',
    title: 'Line totalValue must be positive',
    ruleType: 'value_sanity',
    severity: 'warning',
    config: { field: 'totalValue', min: 0.01 },
  },
];

async function main(): Promise<void> {
  const ds = dataSource;
  if (!ds.isInitialized) await ds.initialize();
  const summary: SeedSummary = {
    organizations: 0,
    profiles: 0,
    clients: 0,
    relationships: 0,
    entries: 0,
    rules: 0,
  };
  try {
    await ds.transaction(async (tx) => {
      // Seed broker orgs + a single member user per profile.
      // Skip orgs whose name we've already created.
      const orgRepo = tx.getRepository('organizations');
      const userRepo = tx.getRepository('users');
      const profileRepo = tx.getRepository('marketplace_broker_profiles');
      const credRepo = tx.getRepository('marketplace_broker_credentials');
      const clientRepo = tx.getRepository('broker_clients');
      const relRepo = tx.getRepository('broker_client_relationships');
      const entryRepo = tx.getRepository('broker_entries');
      const lineRepo = tx.getRepository('broker_entry_lines');
      const packetRepo = tx.getRepository('broker_document_packets');
      const ruleRepo = tx.getRepository('broker_rules');

      // One stable "demo business" org we attach client rows to.
      let demoBiz: any = await orgRepo.findOne({
        where: { name: 'Demo Business Inc.' } as any,
      });
      if (!demoBiz) {
        demoBiz = await orgRepo.save({
          name: 'Demo Business Inc.',
          plan: 'FREE',
          isActive: true,
        });
        summary.organizations += 1;
      }

      for (const fixture of BROKER_FIXTURES) {
        const orgName = `${fixture.displayName} (Broker Org)`;
        let org: any = await orgRepo.findOne({
          where: { name: orgName } as any,
        });
        if (!org) {
          org = await orgRepo.save({
            name: orgName,
            plan: 'FREE',
            isActive: true,
          });
          summary.organizations += 1;
        }
        let user: any = await userRepo.findOne({
          where: { email: `seed+${fixture.slug}@hts.local` } as any,
        });
        if (!user) {
          user = await userRepo.save({
            email: `seed+${fixture.slug}@hts.local`,
            password: 'seed-placeholder-do-not-use',
            firstName: 'Seed',
            lastName: fixture.displayName,
            organizationId: org.id,
            isActive: true,
            emailVerified: true,
          });
        }
        const slug = fixture.slug;
        let profile: any = await profileRepo.findOne({
          where: { slug } as any,
        });
        if (!profile) {
          profile = await profileRepo.save({
            organizationId: org.id,
            ownerUserId: user.id,
            slug,
            displayName: fixture.displayName,
            legalName: fixture.legalName,
            summary: `${fixture.displayName} — auto-seeded for marketplace fixtures.`,
            status: 'published',
            verificationStatus: 'verified',
            countries: fixture.countries,
            serviceCategories: fixture.serviceCategories,
            shipmentModes: fixture.shipmentModes,
            specialties: fixture.specialties,
            ports: fixture.ports,
            credentials: [],
            complianceCertifications: [],
            languages: ['en'],
            verifiedAt: new Date(),
            publishedAt: new Date(),
            tier: 'free',
          });
          summary.profiles += 1;

          await credRepo.save({
            brokerProfileId: profile.id,
            credentialType: 'cbp_filer_code',
            value: `SEED-${slug.slice(0, 6).toUpperCase()}`,
            verifiedAt: new Date(),
            verifiedByUserId: user.id,
          });
        }

        // Client + relationship for the demo business
        let client: any = await clientRepo.findOne({
          where: {
            brokerOrganizationId: org.id,
            clientOrganizationId: demoBiz.id,
          } as any,
        });
        if (!client) {
          client = await clientRepo.save({
            brokerOrganizationId: org.id,
            clientOrganizationId: demoBiz.id,
            name: 'Demo Business Inc.',
            status: 'active',
          });
          summary.clients += 1;
        }
        const existingRel = await relRepo.findOne({
          where: {
            brokerOrganizationId: org.id,
            businessOrganizationId: demoBiz.id,
          } as any,
        });
        if (!existingRel) {
          await relRepo.save({
            brokerOrganizationId: org.id,
            businessOrganizationId: demoBiz.id,
            clientId: client.id,
            status: 'active',
            poaStatus: 'verified',
            startedAt: new Date(),
            onboardingChecklist: [],
          });
          summary.relationships += 1;
        }

        // Entry + 2 lines + packet skeleton (one per broker)
        const existingEntry = await entryRepo.findOne({
          where: {
            brokerOrganizationId: org.id,
            clientId: client.id,
            entryNumber: `SEED-${slug.toUpperCase()}-001`,
          } as any,
        });
        if (!existingEntry) {
          const entry: any = await entryRepo.save({
            brokerOrganizationId: org.id,
            clientId: client.id,
            entryNumber: `SEED-${slug.toUpperCase()}-001`,
            entryType: 'consumption',
            status: 'in_review',
            riskLevel: 'medium',
            currency: 'USD',
          });
          await lineRepo.save([
            {
              entryId: entry.id,
              lineNumber: 1,
              sku: 'SEED-SKU-A',
              description: `Sample line A for ${fixture.displayName}`,
              htsNumber: '6109.10.00',
              countryOfOrigin: fixture.countries[0] ?? 'CN',
              quantity: '100',
              unitOfMeasure: 'EA',
              unitValue: '4.50',
              currency: 'USD',
              totalValue: '450.0000',
            },
            {
              entryId: entry.id,
              lineNumber: 2,
              sku: 'SEED-SKU-B',
              description: `Sample line B for ${fixture.displayName}`,
              htsNumber: '9405.40.84',
              countryOfOrigin: fixture.countries[0] ?? 'CN',
              quantity: '50',
              unitOfMeasure: 'EA',
              unitValue: '12.00',
              currency: 'USD',
              totalValue: '600.0000',
            },
          ]);
          await packetRepo.save({
            brokerOrganizationId: org.id,
            clientId: client.id,
            status: 'extracted',
            source: 'broker',
            label: 'Auto-seeded packet',
            receivedAt: new Date(),
          });
          summary.entries += 1;
        }

        // Rules
        for (const rule of RULE_FIXTURES) {
          const code = `${slug}-${rule.code}`;
          const existing = await ruleRepo.findOne({ where: { code } as any });
          if (existing) continue;
          await ruleRepo.save({
            code,
            title: `${fixture.displayName}: ${rule.title}`,
            description: `Auto-seeded rule for ${fixture.displayName}`,
            scope: 'organization',
            organizationId: org.id,
            severity: rule.severity,
            ruleType: rule.ruleType,
            config: rule.config,
            enabled: true,
          });
          summary.rules += 1;
        }
      }
    });
    // eslint-disable-next-line no-console
    console.log(
      'Seed complete:',
      JSON.stringify(summary, null, 2),
    );
  } finally {
    await ds.destroy();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
