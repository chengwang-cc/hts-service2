import { StripeService } from './stripe.service';

/**
 * Phase 8 (F8.1) Stripe Tax integration unit tests.
 *
 * Strategy
 * --------
 * Mock the Stripe SDK at the method level; assert the params we send
 * have (or don't have) `automatic_tax`. The toggle is driven by
 * `STRIPE_TAX_ENABLED` env — we mutate it per test and restore in
 * afterEach so order doesn't matter.
 *
 * What this proves
 * ----------------
 *   - With the flag OFF, the Stripe call shape is identical to pre-F8.1.
 *   - With the flag ON, automatic_tax: { enabled: true } is set on
 *     checkout sessions + payment intents.
 *   - Setup-mode sessions never get automatic_tax (no charge).
 *
 * What this does NOT prove
 * ------------------------
 *   - That Stripe accepts the call (integration test territory).
 *   - That the customer has a billing address — that's a Stripe-side
 *     prerequisite the rollout plan handles separately.
 */

const buildService = () => {
  const calls = {
    checkoutSessionsCreate: jest.fn(async (p: any) => ({ id: 'cs_test_1', ...p })),
    paymentIntentsCreate: jest.fn(async (p: any) => ({ id: 'pi_test_1', ...p })),
  };
  const stripe = {
    checkout: { sessions: { create: calls.checkoutSessionsCreate } },
    paymentIntents: { create: calls.paymentIntentsCreate },
  };
  return { svc: new StripeService(stripe as any), calls };
};

describe('StripeService — automatic_tax (F8.1)', () => {
  let prior: string | undefined;
  beforeEach(() => {
    prior = process.env.STRIPE_TAX_ENABLED;
  });
  afterEach(() => {
    if (prior === undefined) delete process.env.STRIPE_TAX_ENABLED;
    else process.env.STRIPE_TAX_ENABLED = prior;
  });

  describe('createCheckoutSession', () => {
    it('OMITS automatic_tax when STRIPE_TAX_ENABLED is not "true"', async () => {
      delete process.env.STRIPE_TAX_ENABLED;
      const { svc, calls } = buildService();
      await svc.createCheckoutSession({
        customerId: 'cus_x',
        priceId: 'price_x',
        successUrl: 'https://x/s',
        cancelUrl: 'https://x/c',
        mode: 'subscription',
      });
      const sent = calls.checkoutSessionsCreate.mock.calls[0][0];
      expect(sent.automatic_tax).toBeUndefined();
      expect(sent.customer_update).toBeUndefined();
    });

    it('SETS automatic_tax + customer_update.address=auto when flag is "true"', async () => {
      process.env.STRIPE_TAX_ENABLED = 'true';
      const { svc, calls } = buildService();
      await svc.createCheckoutSession({
        customerId: 'cus_x',
        priceId: 'price_x',
        successUrl: 'https://x/s',
        cancelUrl: 'https://x/c',
        mode: 'subscription',
      });
      const sent = calls.checkoutSessionsCreate.mock.calls[0][0];
      expect(sent.automatic_tax).toEqual({ enabled: true });
      expect(sent.customer_update).toEqual({ address: 'auto' });
    });
  });

  describe('createFlexibleCheckoutSession', () => {
    it('sets automatic_tax for payment mode when flag is on', async () => {
      process.env.STRIPE_TAX_ENABLED = 'true';
      const { svc, calls } = buildService();
      await svc.createFlexibleCheckoutSession({
        mode: 'payment',
        line_items: [],
        success_url: 'https://x/s',
        cancel_url: 'https://x/c',
      });
      const sent = calls.checkoutSessionsCreate.mock.calls[0][0];
      expect(sent.automatic_tax).toEqual({ enabled: true });
    });

    it('OMITS automatic_tax for setup mode even when flag is on', async () => {
      process.env.STRIPE_TAX_ENABLED = 'true';
      const { svc, calls } = buildService();
      await svc.createFlexibleCheckoutSession({
        mode: 'setup',
        success_url: 'https://x/s',
        cancel_url: 'https://x/c',
      });
      const sent = calls.checkoutSessionsCreate.mock.calls[0][0];
      expect(sent.automatic_tax).toBeUndefined();
    });
  });

  describe('createPaymentIntent', () => {
    it('OMITS automatic_tax when STRIPE_TAX_ENABLED is not "true"', async () => {
      delete process.env.STRIPE_TAX_ENABLED;
      const { svc, calls } = buildService();
      await svc.createPaymentIntent({
        customerId: 'cus_x',
        amountUsd: 20.0,
        purpose: 'credit_purchase',
        organizationId: 'org-1',
      });
      const sent = calls.paymentIntentsCreate.mock.calls[0][0];
      expect(sent.automatic_tax).toBeUndefined();
    });

    it('SETS automatic_tax when flag is "true"', async () => {
      process.env.STRIPE_TAX_ENABLED = 'true';
      const { svc, calls } = buildService();
      await svc.createPaymentIntent({
        customerId: 'cus_x',
        amountUsd: 20.0,
        purpose: 'credit_purchase',
        organizationId: 'org-1',
      });
      const sent = calls.paymentIntentsCreate.mock.calls[0][0];
      expect(sent.automatic_tax).toEqual({ enabled: true });
      expect(sent.metadata).toMatchObject({
        organizationId: 'org-1',
        purpose: 'credit_purchase',
      });
    });

    it('works with paymentMethodId + offSession (auto-topup) when flag is on', async () => {
      process.env.STRIPE_TAX_ENABLED = 'true';
      const { svc, calls } = buildService();
      await svc.createPaymentIntent({
        customerId: 'cus_x',
        amountUsd: 5.0,
        purpose: 'auto_topup',
        organizationId: 'org-1',
        paymentMethodId: 'pm_x',
        offSession: true,
      });
      const sent = calls.paymentIntentsCreate.mock.calls[0][0];
      expect(sent.payment_method).toBe('pm_x');
      expect(sent.confirm).toBe(true);
      expect(sent.off_session).toBe(true);
      expect(sent.automatic_tax).toEqual({ enabled: true });
    });
  });
});
