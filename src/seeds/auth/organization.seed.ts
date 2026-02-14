/**
 * Organization Seed Data
 *
 * Pre-seeded organizations for platform admin and test businesses
 */

export interface OrganizationSeed {
  id: string;
  name: string;
  plan: string;
  isActive: boolean;
  settings?: Record<string, any>;
  usageQuotas?: Record<string, number>;
  currentUsage?: Record<string, number>;
}

// Pre-generated UUIDs for consistent seeding (idempotent)
const ORG_IDS = {
  PLATFORM_ADMIN: '10000000-0000-0000-0000-000000000001',
  TEST_BUSINESS_1: '10000000-0000-0000-0000-000000000002',
  TEST_BUSINESS_2: '10000000-0000-0000-0000-000000000003',
};

export const organizationSeed: OrganizationSeed[] = [
  {
    id: ORG_IDS.PLATFORM_ADMIN,
    name: 'HTS Platform Admin',
    plan: 'ADMIN',
    isActive: true,
    settings: {
      isSystemOrg: true,
    },
  },
  {
    id: ORG_IDS.TEST_BUSINESS_1,
    name: 'Acme Corporation',
    plan: 'PROFESSIONAL',
    isActive: true,
    settings: {
      timezone: 'America/New_York',
      defaultLanguage: 'en',
    },
    usageQuotas: {
      monthlyClassifications: 1000,
      monthlyCalculations: 500,
      apiCallsPerMinute: 60,
    },
    currentUsage: {
      monthlyClassifications: 0,
      monthlyCalculations: 0,
    },
  },
  {
    id: ORG_IDS.TEST_BUSINESS_2,
    name: 'Global Trade Inc',
    plan: 'ENTERPRISE',
    isActive: true,
    settings: {
      timezone: 'America/Los_Angeles',
      defaultLanguage: 'en',
    },
    usageQuotas: {
      monthlyClassifications: 10000,
      monthlyCalculations: 5000,
      apiCallsPerMinute: 120,
    },
    currentUsage: {
      monthlyClassifications: 0,
      monthlyCalculations: 0,
    },
  },
];

export { ORG_IDS };
