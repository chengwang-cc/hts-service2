import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { PartnerOriginCacheService } from './partner-origin-cache.service';
import { PartnerOriginEntity } from '../entities/partner-origin.entity';

/**
 * Pure unit tests for origin matching. No DB — we stub the repository's
 * `find()` to return a fixture set of origins, then drive resolve().
 */
describe('PartnerOriginCacheService', () => {
  let svc: PartnerOriginCacheService;
  let stubRows: PartnerOriginEntity[];

  const make = (organizationId: string, originPattern: string): PartnerOriginEntity => {
    const e = new PartnerOriginEntity();
    e.organizationId = organizationId;
    e.originPattern = originPattern;
    e.isActive = true;
    return e;
  };

  beforeEach(async () => {
    stubRows = [];
    const moduleRef = await Test.createTestingModule({
      providers: [
        PartnerOriginCacheService,
        {
          provide: getRepositoryToken(PartnerOriginEntity),
          useValue: {
            find: jest.fn().mockImplementation(() => Promise.resolve(stubRows)),
          },
        },
      ],
    }).compile();
    svc = moduleRef.get(PartnerOriginCacheService);
  });

  afterEach(() => {
    svc.onModuleDestroy();
  });

  it('returns null for a null/empty origin', async () => {
    stubRows = [make('org-cc', '*.chitchats.com')];
    await svc.refresh();
    expect(svc.resolve(null)).toBeNull();
    expect(svc.resolve(undefined)).toBeNull();
    expect(svc.resolve('')).toBeNull();
    expect(svc.resolve('   ')).toBeNull();
  });

  it('matches a subdomain glob to the right organization', async () => {
    stubRows = [make('org-cc', '*.chitchats.com')];
    await svc.refresh();
    expect(svc.resolve('https://www.chitchats.com')?.organizationId).toBe('org-cc');
    expect(svc.resolve('https://merchant.chitchats.com')?.organizationId).toBe('org-cc');
  });

  it('respects port numbers in origin', async () => {
    stubRows = [make('org-cc', '*.chitchats.com')];
    await svc.refresh();
    expect(svc.resolve('https://www.chitchats.com:443')?.organizationId).toBe('org-cc');
    expect(svc.resolve('http://www.chitchats.com:8080')?.organizationId).toBe('org-cc');
  });

  it('does NOT match an unrelated host', async () => {
    stubRows = [make('org-cc', '*.chitchats.com')];
    await svc.refresh();
    expect(svc.resolve('https://evil.com')).toBeNull();
    expect(svc.resolve('https://chitchats.com.evil.com')).toBeNull();
  });

  it('does NOT cross-subdomain (one wildcard level only)', async () => {
    stubRows = [make('org-cc', '*.chitchats.com')];
    await svc.refresh();
    // *.chitchats.com should match foo.chitchats.com but NOT a.b.chitchats.com
    expect(svc.resolve('https://a.b.chitchats.com')).toBeNull();
  });

  it('prefers the more specific pattern when both match', async () => {
    stubRows = [
      make('org-broad', '*.proto.com'),
      make('org-narrow', 'merchant.proto.com'),
    ];
    await svc.refresh();
    expect(svc.resolve('https://merchant.proto.com')?.organizationId).toBe('org-narrow');
    expect(svc.resolve('https://app.proto.com')?.organizationId).toBe('org-broad');
  });

  it('protocol in pattern is informational only — matches both http and https', async () => {
    // The compiler strips the protocol from the pattern. This is deliberate:
    // partners shouldn't need to enumerate http+https separately. Matching
    // is by host (and port), not by scheme.
    stubRows = [make('org-x', 'https://www.example.com')];
    await svc.refresh();
    expect(svc.resolve('https://www.example.com')?.organizationId).toBe('org-x');
    expect(svc.resolve('http://www.example.com')?.organizationId).toBe('org-x');
  });

  it('skips invalid patterns without crashing', async () => {
    // The glob compiler escapes regex metachars, so genuinely malformed
    // input is hard to construct — but the catch-all should still hold.
    stubRows = [make('org-good', '*.good.com'), make('org-bad', '')];
    await svc.refresh();
    expect(svc.resolve('https://x.good.com')?.organizationId).toBe('org-good');
  });

  it('snapshot reflects loaded patterns sorted by specificity', async () => {
    stubRows = [make('a', '*.proto.com'), make('b', 'merchant.proto.com')];
    await svc.refresh();
    const snap = svc.snapshot();
    expect(snap[0].organizationId).toBe('b');
    expect(snap[1].organizationId).toBe('a');
  });

  it('refresh() reloads from the repository', async () => {
    stubRows = [];
    await svc.refresh();
    expect(svc.resolve('https://www.chitchats.com')).toBeNull();
    stubRows = [make('org-cc', '*.chitchats.com')];
    await svc.refresh();
    expect(svc.resolve('https://www.chitchats.com')?.organizationId).toBe('org-cc');
  });
});
