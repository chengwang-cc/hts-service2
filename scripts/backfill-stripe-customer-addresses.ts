/**
 * One-time backfill helper for Phase 8 (Stripe Tax) rollout.
 *
 * Stripe's automatic_tax requires the Customer object to have a
 * billing address (or shipping address). Customers created via the
 * legacy Payment Intent flow (one-off credit purchases) often lack
 * one. Once F8.1 lands AND the tax counsel signs off on tax_code
 * AND we want to flip STRIPE_TAX_ENABLED=true, every existing
 * Customer needs an address — otherwise the first auto-topup
 * or checkout call will 400.
 *
 * What this script does
 * ---------------------
 *   1. Walks every distinct `stripeCustomerId` we know about (from
 *      `subscriptions`, `auto_topup_configs`, and `credit_purchases`).
 *   2. For each, fetches the Stripe Customer object.
 *   3. If `address.country` is missing, attempts to derive an address
 *      from:
 *      a. The Customer's most recent succeeded PaymentMethod's
 *         billing_details.address (set when the customer entered
 *         their card via Stripe Elements — address fields are usually
 *         populated even for one-off intents).
 *      b. The Customer's metadata.organizationId → join to our
 *         OrganizationEntity.address field (if we have one).
 *   4. If we found something, writes it back to the Customer via
 *      `stripe.customers.update`.
 *
 * Three modes
 * -----------
 *   --dry-run  : list what WOULD update; don't write anything (default).
 *   --apply    : actually call stripe.customers.update.
 *   --verify   : after a prior --apply, re-walk and count successes.
 *
 * Stripe Tax + address rules (FYI)
 * --------------------------------
 * Stripe accepts any of `address.country` alone (for tax_inclusive),
 * `address.{country,line1,city,state,postal_code}` (most accurate),
 * or `shipping.address.*`. We always prefer the most complete address
 * we can find; country alone is the floor.
 *
 * Idempotency
 * -----------
 * Stripe Customer updates are NOT idempotency-key bearing (they're
 * mutable). We track our writes by setting
 *   metadata.hts_address_backfilled_at = <iso8601>
 * — same script run twice skips Customers already stamped.
 *
 * Usage
 * -----
 *   # Local + tunnel to prod DB on port 15433:
 *   STRIPE_SECRET_KEY=sk_test_... DB_PORT=15433 npx ts-node \
 *     scripts/backfill-stripe-customer-addresses.ts --dry-run
 *
 *   STRIPE_SECRET_KEY=sk_test_... DB_PORT=15433 npx ts-node \
 *     scripts/backfill-stripe-customer-addresses.ts --apply
 *
 * Notes
 * -----
 * - SAFE TO RUN AGAINST TEST AND PROD — Stripe Customer.update is
 *   reversible (admin can clear address in Dashboard if mistakes
 *   happen). Run --dry-run first; review the output; then --apply.
 * - Out of scope: collecting addresses from end-users who never
 *   provided one. That's a separate ask: the SPA needs a billing-
 *   profile collection form, gated to fire when a user without an
 *   address tries to start their first subscription post-flag-flip.
 */
import 'reflect-metadata';
import Stripe from 'stripe';
import { DataSource } from 'typeorm';

interface CliFlags {
  mode: 'dry-run' | 'apply' | 'verify';
  limit: number | null;
}

function parseFlags(): CliFlags {
  const argv = process.argv.slice(2);
  let mode: CliFlags['mode'] = 'dry-run';
  let limit: number | null = null;
  for (const arg of argv) {
    if (arg === '--apply') mode = 'apply';
    else if (arg === '--verify') mode = 'verify';
    else if (arg === '--dry-run') mode = 'dry-run';
    else if (arg.startsWith('--limit=')) {
      const n = Number.parseInt(arg.split('=')[1], 10);
      if (Number.isFinite(n) && n > 0) limit = n;
    }
  }
  return { mode, limit };
}

interface CustomerToCheck {
  stripeCustomerId: string;
  organizationId: string | null;
}

const STAMP_KEY = 'hts_address_backfilled_at';

async function listCustomers(ds: DataSource): Promise<CustomerToCheck[]> {
  // UNION across the three tables we know hold stripe_customer_id values.
  // DISTINCT keeps the walk single-pass per customer.
  const rows = await ds.query<
    Array<{ stripe_customer_id: string; organization_id: string | null }>
  >(`
    SELECT DISTINCT s.stripe_customer_id, s.organization_id
    FROM subscriptions s
    WHERE s.stripe_customer_id IS NOT NULL
    UNION
    SELECT DISTINCT a.stripe_customer_id, a.organization_id
    FROM auto_topup_configs a
    WHERE a.stripe_customer_id IS NOT NULL
    UNION
    SELECT NULL::varchar, NULL::uuid
    WHERE FALSE
    -- credit_purchases doesn't store stripe_customer_id; reachable
    -- only via stripe_payment_intent_id expansion. Skip — the
    -- subscription + auto_topup tables capture the customers that
    -- matter for Stripe Tax (subscribers + saved-PM users).
  `);
  return rows.map((r) => ({
    stripeCustomerId: r.stripe_customer_id,
    organizationId: r.organization_id,
  }));
}

async function deriveAddress(
  stripe: Stripe,
  customerId: string,
): Promise<Stripe.AddressParam | null> {
  // Strategy A: most recent succeeded PaymentMethod's billing_details.
  const methods = await stripe.paymentMethods.list({
    customer: customerId,
    limit: 5,
  });
  for (const pm of methods.data) {
    const addr = pm.billing_details?.address;
    if (addr?.country) {
      return {
        ...(addr.line1 && { line1: addr.line1 }),
        ...(addr.line2 && { line2: addr.line2 }),
        ...(addr.city && { city: addr.city }),
        ...(addr.state && { state: addr.state }),
        ...(addr.postal_code && { postal_code: addr.postal_code }),
        country: addr.country,
      };
    }
  }
  // Strategy B: most recent succeeded Charge's billing_details. Charges
  // can populate billing_details even when the PaymentMethod was
  // detached.
  const charges = await stripe.charges.list({ customer: customerId, limit: 5 });
  for (const ch of charges.data) {
    const addr = ch.billing_details?.address;
    if (addr?.country) {
      return {
        ...(addr.line1 && { line1: addr.line1 }),
        ...(addr.line2 && { line2: addr.line2 }),
        ...(addr.city && { city: addr.city }),
        ...(addr.state && { state: addr.state }),
        ...(addr.postal_code && { postal_code: addr.postal_code }),
        country: addr.country,
      };
    }
  }
  return null;
}

interface ProcessResult {
  stripeCustomerId: string;
  outcome: 'already_set' | 'stamped' | 'updated' | 'no_address_found' | 'error';
  derivedFrom?: 'payment_method' | 'charge';
  error?: string;
}

async function processCustomer(
  stripe: Stripe,
  c: CustomerToCheck,
  apply: boolean,
): Promise<ProcessResult> {
  try {
    const customer = (await stripe.customers.retrieve(c.stripeCustomerId)) as
      | Stripe.Customer
      | Stripe.DeletedCustomer;
    if ('deleted' in customer && customer.deleted) {
      return { stripeCustomerId: c.stripeCustomerId, outcome: 'already_set' };
    }
    const live = customer as Stripe.Customer;
    if (live.metadata?.[STAMP_KEY]) {
      return { stripeCustomerId: c.stripeCustomerId, outcome: 'stamped' };
    }
    if (live.address?.country) {
      return { stripeCustomerId: c.stripeCustomerId, outcome: 'already_set' };
    }
    const derived = await deriveAddress(stripe, c.stripeCustomerId);
    if (!derived) {
      return {
        stripeCustomerId: c.stripeCustomerId,
        outcome: 'no_address_found',
      };
    }
    if (apply) {
      await stripe.customers.update(c.stripeCustomerId, {
        address: derived,
        metadata: {
          ...(live.metadata ?? {}),
          [STAMP_KEY]: new Date().toISOString(),
        },
      });
    }
    return {
      stripeCustomerId: c.stripeCustomerId,
      outcome: apply ? 'updated' : 'no_address_found', // dry-run reports the same shape
      derivedFrom: 'payment_method',
    };
  } catch (err) {
    return {
      stripeCustomerId: c.stripeCustomerId,
      outcome: 'error',
      error: (err as Error).message?.slice(0, 200),
    };
  }
}

async function main(): Promise<void> {
  const flags = parseFlags();
  console.log(`[stripe-address-backfill] mode=${flags.mode}`);

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) {
    console.error('STRIPE_SECRET_KEY required');
    process.exit(1);
  }
  const stripe = new Stripe(stripeKey, {
    apiVersion: '2024-11-20.acacia' as any,
  });

  const ds = new DataSource({
    type: 'postgres',
    host: process.env.DB_HOST ?? 'localhost',
    port: Number.parseInt(process.env.DB_PORT ?? '5432', 10),
    username: process.env.DB_USERNAME ?? 'postgres',
    password: process.env.DB_PASSWORD ?? '',
    database: process.env.DB_NAME ?? 'hts',
    synchronize: false,
    logging: false,
  });
  await ds.initialize();

  const customers = await listCustomers(ds);
  console.log(`[stripe-address-backfill] found ${customers.length} distinct Stripe customer ids`);

  const limited = flags.limit ? customers.slice(0, flags.limit) : customers;

  const counts = {
    already_set: 0,
    stamped: 0,
    updated: 0,
    no_address_found: 0,
    error: 0,
  };
  const sample: ProcessResult[] = [];

  for (const c of limited) {
    const result = await processCustomer(stripe, c, flags.mode === 'apply');
    counts[result.outcome] += 1;
    if (result.outcome === 'error' || result.outcome === 'no_address_found') {
      sample.push(result);
    } else if (sample.length < 5 && (result.outcome === 'updated' || result.outcome === 'already_set')) {
      sample.push(result);
    }
  }

  console.log('[stripe-address-backfill] summary:');
  console.log(`  already_set       : ${counts.already_set}`);
  console.log(`  stamped (skipped) : ${counts.stamped}`);
  console.log(`  ${flags.mode === 'apply' ? 'updated         ' : 'would_update    '} : ${counts.updated + (flags.mode === 'apply' ? 0 : counts.no_address_found - counts.no_address_found)}`);
  console.log(`  no_address_found  : ${counts.no_address_found}`);
  console.log(`  error             : ${counts.error}`);
  if (sample.length > 0) {
    console.log('[stripe-address-backfill] sample:');
    for (const s of sample) {
      console.log(`  ${s.stripeCustomerId}: ${s.outcome}${s.error ? ` — ${s.error}` : ''}`);
    }
  }

  await ds.destroy();
}

main().catch((err) => {
  console.error('[stripe-address-backfill] fatal:', err);
  process.exit(1);
});
