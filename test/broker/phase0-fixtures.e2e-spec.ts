import { readFileSync } from 'node:fs';
import { join } from 'node:path';

interface Phase0Fixture {
  fixtureId: string;
  organizations: Array<{
    id: string;
    type: string;
    name: string;
  }>;
  users: Array<{
    organizationId: string;
    email: string;
  }>;
  storeConnections: Array<{
    organizationId: string;
    platform: string;
    platformStoreId: string;
    secretRef: string;
  }>;
  marketplaceRequests: Array<{
    requesterOrganizationId: string;
    visibilityMode: string;
  }>;
  acceptanceScenarios: Array<{
    id: string;
    description: string;
  }>;
}

describe('Phase 0 broker marketplace baseline fixtures', () => {
  const fixturePath = join(
    __dirname,
    '..',
    'fixtures',
    'phase0-broker-marketplace-baseline.json',
  );
  const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as Phase0Fixture;
  const organizationIds = new Set(fixture.organizations.map((org) => org.id));

  it('contains the required baseline organizations', () => {
    expect(fixture.fixtureId).toBe('phase0-broker-marketplace-baseline');
    expect(fixture.organizations.filter((org) => org.type === 'broker')).toHaveLength(2);
    expect(fixture.organizations.filter((org) => org.type === 'importer')).toHaveLength(1);
    expect(fixture.organizations.filter((org) => org.type === 'exporter')).toHaveLength(1);
  });

  it('links users, stores, and marketplace requests to known organizations', () => {
    for (const user of fixture.users) {
      expect(organizationIds.has(user.organizationId)).toBe(true);
      expect(user.email).toMatch(/^[^@\s]+@[^@\s]+\.[^@\s]+$/);
    }

    for (const store of fixture.storeConnections) {
      expect(organizationIds.has(store.organizationId)).toBe(true);
      expect(['shopify', 'woocommerce']).toContain(store.platform);
      expect(store.platformStoreId).toBeTruthy();
      expect(store.secretRef).toMatch(/^test-secret-ref-/);
    }

    for (const request of fixture.marketplaceRequests) {
      expect(organizationIds.has(request.requesterOrganizationId)).toBe(true);
      expect(['private', 'invited', 'public']).toContain(request.visibilityMode);
    }
  });

  it('defines acceptance scenarios for the first trust sprint', () => {
    expect(fixture.acceptanceScenarios.map((scenario) => scenario.id)).toEqual(
      expect.arrayContaining([
        'visibility-private-no-broad-match',
        'broker-conversation-isolation',
        'store-registration-auth-required',
      ]),
    );
    for (const scenario of fixture.acceptanceScenarios) {
      expect(scenario.description.length).toBeGreaterThan(20);
    }
  });
});
