/**
 * User Seed Data
 *
 * Pre-seeded users for platform admin and test accounts
 * Default password for all users: "password123"
 * Hash generated with: bcrypt.hash('password123', 10)
 */

import { ORG_IDS } from './organization.seed';
import { ROLE_IDS } from './role.seed';

export interface UserSeed {
  id: string;
  email: string;
  password: string; // bcrypt hash
  firstName: string;
  lastName: string;
  organizationId: string;
  isActive: boolean;
  emailVerified: boolean;
  roleIds: string[];
}

// Pre-generated UUIDs for consistent seeding (idempotent)
const USER_IDS = {
  PLATFORM_ADMIN: '30000000-0000-0000-0000-000000000001',
  ACME_ADMIN: '30000000-0000-0000-0000-000000000002',
  ACME_USER: '30000000-0000-0000-0000-000000000003',
  GLOBAL_TRADE_ADMIN: '30000000-0000-0000-0000-000000000004',
};

// Password: "password123"
// Generated with: bcrypt.hash('password123', 10)
const DEFAULT_PASSWORD_HASH =
  '$2b$10$fyHpe8Bkwh0cpGeYd0nDW.uVqmpIM5s7AYekYlNU4S4fdHOTBZCH6';

export const userSeed: UserSeed[] = [
  {
    id: USER_IDS.PLATFORM_ADMIN,
    email: 'admin@hts.com',
    password: DEFAULT_PASSWORD_HASH,
    firstName: 'Platform',
    lastName: 'Admin',
    organizationId: ORG_IDS.PLATFORM_ADMIN,
    isActive: true,
    emailVerified: true,
    roleIds: [ROLE_IDS.PLATFORM_ADMIN],
  },
  {
    id: USER_IDS.ACME_ADMIN,
    email: 'john@acmecorp.com',
    password: DEFAULT_PASSWORD_HASH,
    firstName: 'John',
    lastName: 'Doe',
    organizationId: ORG_IDS.TEST_BUSINESS_1,
    isActive: true,
    emailVerified: true,
    roleIds: [ROLE_IDS.ORG_ADMIN],
  },
  {
    id: USER_IDS.ACME_USER,
    email: 'jane@acmecorp.com',
    password: DEFAULT_PASSWORD_HASH,
    firstName: 'Jane',
    lastName: 'Smith',
    organizationId: ORG_IDS.TEST_BUSINESS_1,
    isActive: true,
    emailVerified: true,
    roleIds: [ROLE_IDS.BUSINESS_USER],
  },
  {
    id: USER_IDS.GLOBAL_TRADE_ADMIN,
    email: 'admin@globaltrade.com',
    password: DEFAULT_PASSWORD_HASH,
    firstName: 'Global',
    lastName: 'Admin',
    organizationId: ORG_IDS.TEST_BUSINESS_2,
    isActive: true,
    emailVerified: true,
    roleIds: [ROLE_IDS.ORG_ADMIN],
  },
];

export { USER_IDS };
