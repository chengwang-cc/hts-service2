/**
 * Role Seed Data
 *
 * System roles with permission sets
 */

export interface RoleSeed {
  id: string;
  name: string;
  description: string;
  permissions: string[];
  isActive: boolean;
}

// Pre-generated UUIDs for consistent seeding (idempotent)
const ROLE_IDS = {
  PLATFORM_ADMIN: '20000000-0000-0000-0000-000000000001',
  ORG_ADMIN: '20000000-0000-0000-0000-000000000002',
  BUSINESS_USER: '20000000-0000-0000-0000-000000000003',
  VIEWER: '20000000-0000-0000-0000-000000000004',
};

export const roleSeed: RoleSeed[] = [
  {
    id: ROLE_IDS.PLATFORM_ADMIN,
    name: 'Platform Administrator',
    description: 'Full platform access with all permissions',
    permissions: [
      // Admin permissions
      'admin:*',
      'admin:users',
      'admin:users:create',
      'admin:users:edit',
      'admin:users:delete',
      'admin:users:view',
      'admin:roles',
      'admin:roles:create',
      'admin:roles:edit',
      'admin:roles:delete',
      'admin:settings',

      // HTS permissions
      'hts:*',
      'hts:import',
      'hts:view',
      'hts:edit',

      // Knowledge Base permissions
      'kb:*',
      'kb:manage',
      'kb:view',
      'kb:edit',

      // Formula permissions
      'formula:*',
      'formula:view',
      'formula:create',
      'formula:approve',
      'formula:delete',

      // Test Case permissions
      'test-case:*',
      'test-case:view',
      'test-case:create',
      'test-case:edit',
      'test-case:run',
      'test-case:delete',

      // Export permissions
      'export:*',
      'export:view',
      'export:create',
      'export:delete',

      // Analytics permissions
      'analytics:*',
      'analytics:view',

      // Billing permissions
      'billing:*',
      'billing:view',
      'billing:manage',
    ],
    isActive: true,
  },
  {
    id: ROLE_IDS.ORG_ADMIN,
    name: 'Organization Administrator',
    description: 'Organization admin with team management capabilities',
    permissions: [
      // Classification & Calculation
      'classify:product',
      'calculate:duty',

      // Data Management
      'export:own',
      'import:csv',

      // Team Management
      'team:manage',
      'team:invite',
      'team:view',

      // API Access
      'api:use',
      'api:view-keys',
      'api:create-keys',

      // Organization Settings
      'org:settings',
      'org:billing:view',

      // Analytics (org-level)
      'analytics:view-org',
    ],
    isActive: true,
  },
  {
    id: ROLE_IDS.BUSINESS_USER,
    name: 'Business User',
    description: 'Standard business user for classification and calculation',
    permissions: [
      // Classification & Calculation
      'classify:product',
      'calculate:duty',

      // Data Management
      'export:own',

      // API Access
      'api:use',

      // View own data
      'data:view-own',
    ],
    isActive: true,
  },
  {
    id: ROLE_IDS.VIEWER,
    name: 'Viewer',
    description: 'Read-only access to organization data',
    permissions: [
      // View only
      'data:view-own',
      'analytics:view-org',
    ],
    isActive: true,
  },
];

export { ROLE_IDS };
