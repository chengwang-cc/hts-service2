import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  INestApplication,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { OrgPermissionsGuard } from '../../src/modules/auth/guards/org-permissions.guard';
import { BrokerEntriesController } from '../../src/modules/broker-entries/controllers/broker-entries.controller';
import { BrokerDutyEstimatorService } from '../../src/modules/broker-entries/services/broker-duty-estimator.service';
import { BrokerEntriesService } from '../../src/modules/broker-entries/services/broker-entries.service';
import { BrokerShipmentsService } from '../../src/modules/broker-entries/services/broker-shipments.service';

/**
 * R0-D-03 — supertest cross-tenant guard test. Boots a minimal Nest test
 * module containing just the broker-entries controller, overrides JWT auth
 * with a header-driven fake (so we don't need a real token signer), and
 * exercises the controller with two different test orgs to prove that
 * tenant boundaries hold at the HTTP boundary.
 *
 * The service is stubbed to mirror production tenant-check behaviour:
 * `requireOwned` throws ForbiddenException when the calling org doesn't
 * match the resource's brokerOrganizationId.
 */

const TENANT_A = 'org-aaa-aaa-aaa';
const TENANT_B = 'org-bbb-bbb-bbb';
const ENTRY_A_ID = '00000000-0000-0000-0000-000000000a01';
const ENTRY_B_ID = '00000000-0000-0000-0000-000000000b01';

@Injectable()
class HeaderAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const orgId = req.headers['x-test-org'];
    const userId = req.headers['x-test-user'] ?? 'test-user-1';
    const permsHeader = req.headers['x-test-permissions'];
    if (!orgId) return false;
    req.user = {
      id: userId,
      organizationId: orgId,
      roles: [
        {
          permissions: permsHeader
            ? String(permsHeader).split(',').map((s) => s.trim())
            : ['broker:entries:view', 'broker:entries:write'],
        },
      ],
    };
    return true;
  }
}

describe('Broker entries cross-tenant guard (R0-D-03)', () => {
  let app: INestApplication;
  const entriesByOrg = new Map<string, Set<string>>([
    [TENANT_A, new Set([ENTRY_A_ID])],
    [TENANT_B, new Set([ENTRY_B_ID])],
  ]);

  function makeServiceStub(): any {
    const tenantCheck = (ctxOrgId: string, entryId: string) => {
      const allowed = entriesByOrg.get(ctxOrgId) ?? new Set();
      if (!allowed.has(entryId)) {
        // Production code checks "not found" vs "wrong tenant" — both look the
        // same to the attacker (404 or 403) to avoid leaking entry existence.
        // For this test we use 403 to mirror requireOwned()'s behaviour when
        // the entry is found in some org but not the caller's.
        const ownsEntry = [...entriesByOrg.values()].some((s) =>
          s.has(entryId),
        );
        throw ownsEntry
          ? new ForbiddenException('Entry belongs to another tenant')
          : new NotFoundException('Entry not found');
      }
    };
    return {
      list: jest.fn(async (ctx: any) => ({
        rows: [...(entriesByOrg.get(ctx.organizationId) ?? [])].map((id) => ({
          id,
        })),
        total: (entriesByOrg.get(ctx.organizationId) ?? new Set()).size,
        limit: 25,
        offset: 0,
      })),
      getDetail: jest.fn(async (ctx: any, id: string) => {
        tenantCheck(ctx.organizationId, id);
        return { id, brokerOrganizationId: ctx.organizationId };
      }),
      update: jest.fn(async (ctx: any, id: string, dto: any) => {
        tenantCheck(ctx.organizationId, id);
        return { id, status: dto.status, brokerOrganizationId: ctx.organizationId };
      }),
    };
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [BrokerEntriesController],
      providers: [
        { provide: BrokerEntriesService, useValue: makeServiceStub() },
        {
          provide: BrokerShipmentsService,
          useValue: {
            list: jest.fn(async () => ({ rows: [], total: 0 })),
            create: jest.fn(),
          },
        },
        {
          provide: BrokerDutyEstimatorService,
          useValue: { estimateForEntry: jest.fn(async () => ({})) },
        },
        OrgPermissionsGuard,
        Reflector,
        // Register the header-auth guard globally so it runs ahead of
        // OrgPermissionsGuard and populates req.user.
        { provide: APP_GUARD, useClass: HeaderAuthGuard },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /broker/entries/:id returns 200 for owner tenant', async () => {
    await request(app.getHttpServer())
      .get(`/broker/entries/${ENTRY_A_ID}`)
      .set('x-test-org', TENANT_A)
      .expect(200)
      .expect(({ body }) => {
        expect(body.data.id).toBe(ENTRY_A_ID);
        expect(body.data.brokerOrganizationId).toBe(TENANT_A);
      });
  });

  it('GET /broker/entries/:id returns 403 when called by a different tenant', async () => {
    await request(app.getHttpServer())
      .get(`/broker/entries/${ENTRY_A_ID}`)
      .set('x-test-org', TENANT_B)
      .expect(403);
  });

  it('PATCH /broker/entries/:id returns 403 cross-tenant', async () => {
    await request(app.getHttpServer())
      .patch(`/broker/entries/${ENTRY_A_ID}`)
      .set('x-test-org', TENANT_B)
      .send({ status: 'in_review' })
      .expect(403);
  });

  it('GET /broker/entries scopes the list to the caller tenant', async () => {
    const res = await request(app.getHttpServer())
      .get('/broker/entries')
      .set('x-test-org', TENANT_A)
      .expect(200);
    expect(res.body.data.rows.map((r: any) => r.id)).toEqual([ENTRY_A_ID]);
  });

  it('returns 403 when the user has none of the required permissions', async () => {
    await request(app.getHttpServer())
      .get(`/broker/entries/${ENTRY_A_ID}`)
      .set('x-test-org', TENANT_A)
      .set('x-test-permissions', 'broker:rules:view')
      .expect(403);
  });

  it('admin:* wildcard bypasses org-permission check (platform_admin role)', async () => {
    await request(app.getHttpServer())
      .get(`/broker/entries/${ENTRY_A_ID}`)
      .set('x-test-org', TENANT_A)
      .set('x-test-permissions', 'admin:*')
      .expect(200);
  });
});
