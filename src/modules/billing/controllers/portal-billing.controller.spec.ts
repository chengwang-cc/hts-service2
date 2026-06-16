import {
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { PortalBillingController } from './portal-billing.controller';
import { PortalCheckoutDto } from '../dto/portal-checkout.dto';

const ORG = '11111111-1111-1111-1111-111111111111';

const ORIGINAL_ENV = { ...process.env };

const fakeUser = (overrides: Record<string, unknown> = {}) =>
  ({
    id: 'u1',
    email: 'admin@example.com',
    organizationId: ORG,
    ...overrides,
  }) as any;

const makeOrgRepo = (org: Partial<{ id: string; plan: string; type: string }> | null) => ({
  findOne: jest.fn(async ({ where }: any) =>
    org && org.id === where.id ? org : null,
  ),
});

const makeStripe = (overrides: Partial<{ url: string | null; id: string }> = {}) => ({
  createFlexibleCheckoutSession: jest.fn(async () => ({
    id: overrides.id ?? 'cs_test_xyz',
    url: overrides.url === undefined ? 'https://checkout.stripe.com/c/cs_test_xyz' : overrides.url,
  })),
});

const makeSubs = () => ({
  getOrCreateStripeCustomer: jest.fn(async () => 'cus_test_abc'),
});

const buildController = (
  org: Partial<{ id: string; plan: string; type: string }> | null,
  stripeOverrides: Partial<{ url: string | null; id: string }> = {},
) => {
  const orgRepo = makeOrgRepo(org);
  const stripe = makeStripe(stripeOverrides);
  const subs = makeSubs();
  const ctrl = new PortalBillingController(stripe as any, subs as any, orgRepo as any);
  return { ctrl, orgRepo, stripe, subs };
};

const dto = (over: Partial<PortalCheckoutDto> = {}): PortalCheckoutDto => ({
  plan: 'STARTER',
  ...over,
});

describe('PortalBillingController.createCheckoutSession', () => {
  beforeEach(() => {
    process.env.STRIPE_PRICE_STARTER_MONTHLY = 'price_starter_m';
    process.env.STRIPE_PRICE_STARTER_YEARLY = 'price_starter_y';
    process.env.STRIPE_PRICE_PROFESSIONAL_MONTHLY = 'price_pro_m';
    process.env.STRIPE_PRICE_PROFESSIONAL_YEARLY = 'price_pro_y';
    process.env.STRIPE_PRICE_ENTERPRISE_MONTHLY = 'price_ent_m';
    process.env.STRIPE_PRICE_ENTERPRISE_YEARLY = 'price_ent_y';
    process.env.SPA_BASE_URL = 'https://hts.proto.com';
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('returns the Stripe checkout URL + session id on the happy path', async () => {
    const { ctrl, stripe } = buildController({ id: ORG, plan: 'FREE', type: 'customer' });
    const res = await ctrl.createCheckoutSession(fakeUser(), dto());
    expect(res).toEqual({
      url: 'https://checkout.stripe.com/c/cs_test_xyz',
      sessionId: 'cs_test_xyz',
    });

    const call = (stripe.createFlexibleCheckoutSession.mock.calls[0] as any[])[0] as any;
    expect(call.mode).toBe('subscription');
    expect(call.customer).toBe('cus_test_abc');
    expect(call.line_items).toEqual([{ price: 'price_starter_m', quantity: 1 }]);
    expect(call.client_reference_id).toBe(ORG);
    expect(call.metadata).toMatchObject({
      organizationId: ORG,
      plan: 'STARTER',
      interval: 'month',
      initiatedBy: 'portal',
    });
  });

  it('routes a customer org to /business-portal/billing on the success url', async () => {
    const { ctrl, stripe } = buildController({ id: ORG, plan: 'FREE', type: 'customer' });
    await ctrl.createCheckoutSession(fakeUser(), dto());
    const { success_url, cancel_url } = (stripe.createFlexibleCheckoutSession.mock.calls[0] as any[])[0] as any;
    expect(success_url).toBe(
      'https://hts.proto.com/business-portal/billing?status=success&plan=STARTER&session={CHECKOUT_SESSION_ID}',
    );
    expect(cancel_url).toBe('https://hts.proto.com/business-portal/billing?status=cancel');
  });

  it('routes a partner org to /partner-portal/billing on the success url', async () => {
    const { ctrl, stripe } = buildController({ id: ORG, plan: 'FREE', type: 'partner' });
    await ctrl.createCheckoutSession(fakeUser(), dto());
    const { success_url } = (stripe.createFlexibleCheckoutSession.mock.calls[0] as any[])[0] as any;
    expect(success_url).toContain('/partner-portal/billing?status=success');
  });

  it('selects the yearly price id when interval=year', async () => {
    const { ctrl, stripe } = buildController({ id: ORG, plan: 'FREE', type: 'customer' });
    await ctrl.createCheckoutSession(fakeUser(), dto({ plan: 'PROFESSIONAL', interval: 'year' }));
    const call = (stripe.createFlexibleCheckoutSession.mock.calls[0] as any[])[0] as any;
    expect(call.line_items[0].price).toBe('price_pro_y');
    expect(call.metadata.interval).toBe('year');
  });

  // Note: the controller falls back to test-mode price defaults when
  // STRIPE_PRICE_* envs are absent, so a missing env no longer trips a
  // 500 — it serves the test-mode price id instead. We keep a coverage
  // sanity check on the fallback rather than the missing-env path.
  it('falls back to test-mode price defaults when STRIPE_PRICE_* env is unset', async () => {
    delete process.env.STRIPE_PRICE_ENTERPRISE_MONTHLY;
    const { ctrl, stripe } = buildController({ id: ORG, plan: 'FREE', type: 'customer' });
    await ctrl.createCheckoutSession(fakeUser(), dto({ plan: 'ENTERPRISE' }));
    const call = (stripe.createFlexibleCheckoutSession.mock.calls[0] as any[])[0] as any;
    // The default starts with 'price_' — assert it's a Stripe price id,
    // not the env-provided 'price_ent_m' from beforeEach.
    expect(call.line_items[0].price).toMatch(/^price_/);
    expect(call.line_items[0].price).not.toBe('price_ent_m');
  });

  it('throws 400 when the org is not found', async () => {
    const { ctrl } = buildController(null);
    await expect(
      ctrl.createCheckoutSession(fakeUser(), dto()),
    ).rejects.toThrow(BadRequestException);
  });

  it('throws 400 (no-op upgrade) when the org is already on the requested plan', async () => {
    const { ctrl, stripe } = buildController({ id: ORG, plan: 'STARTER', type: 'customer' });
    await expect(
      ctrl.createCheckoutSession(fakeUser(), dto({ plan: 'STARTER' })),
    ).rejects.toThrow(/already on the STARTER plan/);
    expect(stripe.createFlexibleCheckoutSession).not.toHaveBeenCalled();
  });

  it('throws 500 when Stripe returns no URL', async () => {
    const { ctrl } = buildController(
      { id: ORG, plan: 'FREE', type: 'customer' },
      { url: null },
    );
    await expect(
      ctrl.createCheckoutSession(fakeUser(), dto()),
    ).rejects.toThrow(InternalServerErrorException);
  });
});
