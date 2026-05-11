# Post-Merge Deep Review — PR #2 (duty display mode) & PR #3 (calculator validation)

**Date:** 2026-05-11
**Scope:** Verifying no gaps/regressions across `hts-service` + every frontend that consumes it (`hts-ui`, `hts-web2`, `hts-plugins`, `hts-shopify-extension`, `ecommerce-plugins`, `hts-salesforce`).

---

## TL;DR — Verdict

**One real regression and two pre-deploy gates.** Everything else lines up.

| Severity | Finding |
|---|---|
| 🔴 **BLOCKER — must fix before deploy** | hts-ui legacy `CalculatorHomePage` (still routed at `/v2/calculator`) sends `weight` (not in DTO) and a **string** `tradeAgreementCertificate` (DTO is boolean). PR #3's `forbidNonWhitelisted: true` will now 400 every request from this page. |
| 🟡 **Deploy gate** | PR #2 adds a NOT NULL column to `shopify_sessions`. Migration `AddDutyDisplayMode1778175965979` must run **before** the new image boots, or every session save will crash. |
| 🟡 **Deploy gate** | The PR-#3 server changes are in `main` but `hts-service` deploys are typically tied to a release artifact — confirm a fresh build was published. |
| 🟢 OK | hts-ui CalculatorV2Service, hts-web2 TariffCalculator, hts-plugins CalculatorApiClient, hts-shopify-extension Checkout banner. All payloads conform; the additive `meta.countryOfOrigin` / `estimate.dutyDisplayMode` fields are safely consumed. |

---

## 1. PR #3 — `countryOfOrigin` validation. Cross-caller audit.

**Endpoint affected:** `POST /api/v1/calculator/calculate` (the **public**, API-key-guarded endpoint). Internal `POST /calculator/calculate` is unchanged.

**New constraints:**
- `countryOfOrigin` must match `/^[A-Za-z]{2}$/`, must be non-empty.
- Unknown body fields → 400 (`forbidNonWhitelisted: true`, controller-scoped).
- Response `meta` now includes `countryOfOrigin` (additive, safe).

### 1.1 Every caller, audited

| Caller | File | Endpoint resolved | Country format | Extra fields? | Verdict |
|---|---|---|---|---|---|
| **hts-web2 TariffCalculator** | [`src/app/pages/tariff-calculator/tariff-calculator.ts:285-297`](../../../hts-web2/src/app/pages/tariff-calculator/tariff-calculator.ts) | `${calculatorApiBaseUrl}/calculator/calculate` → `https://api.usahts.com/api/v1/calculator/calculate` | `.toUpperCase()` on send, regex case-insensitive | All whitelisted | 🟢 OK |
| **hts-ui CalculatorV2Service** | [`projects/website/src/app/features/calculator-v2/services/calculator-v2.service.ts:34-47`](../../../hts-ui/projects/website/src/app/features/calculator-v2/services/calculator-v2.service.ts) | `${apiBase}/v1/calculator/calculate` (apiBase = `https://api.usahts.com/api`) → public | ISO-2 from `COMMON_COUNTRIES` (US/CN/MX/CA/JP/…) | All whitelisted | 🟢 OK |
| **hts-ui legacy `CalculatorService` + `CalculatorHomePage`** | [`projects/website/src/app/features/calculator/services/calculator.service.ts:35`](../../../hts-ui/projects/website/src/app/features/calculator/services/calculator.service.ts) + [`pages/calculator-home.page.ts:309-317`](../../../hts-ui/projects/website/src/app/features/calculator/pages/calculator-home.page.ts) | `ApiService.post('/calculator/calculate')` → baseUrl is `apiBaseUrl + apiVersion` = `https://api.usahts.com/api/v1` → **public** | ISO-2 from same `COMMON_COUNTRIES` ✓ | **Sends `weight`** (not `weightKg`) **and** `tradeAgreementCertificate` as a **string** (`"USMCA"`) when DTO declares `boolean` | 🔴 **WILL 400** |
| **hts-plugins CalculatorApiClient** | [`src/background/api/calculator-api.ts:17-23`](../../../hts-plugins/src/background/api/calculator-api.ts) | hard-coded `/api/v1/calculator/calculate` | ISO-2 expected | Input type ([`api-types.ts:47-57`](../../../hts-plugins/src/shared/types/api-types.ts)) is a strict subset of DTO (`quantityUnit` IS in DTO line 58 — earlier agent claim was wrong) | 🟢 OK |
| **hts-shopify-extension** | [`extensions/hts-duty-estimate/src/Checkout.jsx`](../../../hts-shopify-extension/extensions/hts-duty-estimate/src/Checkout.jsx) | Hits `/widget/checkout/estimate`, **not** `/calculator/calculate` | N/A | N/A | 🟢 Unaffected |
| `ecommerce-plugins`, `hts-salesforce` | — | No calculator calls found | — | — | 🟢 None |

**Routing confirmation for the legacy page:**

```ts
// hts-ui/projects/website/src/app/app.routes.ts:66-71
{
  path: 'v2/calculator',           // ← confusing: 'v2/' path actually loads the LEGACY page
  loadComponent: () =>
    import('./features/calculator/pages/calculator-home.page')
      .then((m) => m.CalculatorHomePage),
}
```

And `path: 'calculator'` (no `v2/` prefix) is the calculator-v2 page. The "v2" in the route path is historical — the **legacy** code lives at `/v2/calculator`, the **rewrite** lives at `/calculator`. Anyone hitting `https://www.usahts.com/v2/calculator` and clicking Calculate will now get a 400.

### 1.2 The exact failing payload

`hts-ui/projects/website/src/app/features/calculator/pages/calculator-home.page.ts:309-317`:

```ts
const request: CalculationRequest = {
  htsNumber: data.htsNumber,
  countryOfOrigin: data.countryOfOrigin,
  declaredValue: data.declaredValue,
  currency: data.currency || 'USD',
  weight: data.weight,                              // ❌ not in CalculatePublicDto
  quantity: data.quantity,
  tradeAgreementCertificate: data.tradeAgreementCertificate, // ❌ string, DTO is boolean
};
```

`CalculationRequest` is defined at [`hts-ui/projects/shared/src/lib/models/calculation.models.ts:8-17`](../../../hts-ui/projects/shared/src/lib/models/calculation.models.ts):

```ts
export interface CalculationRequest {
  htsNumber: string;
  countryOfOrigin: string;
  declaredValue: number;
  currency?: string;
  weight?: number;                              // should be weightKg
  quantity?: number;
  tradeAgreementCertificate?: string;           // should be boolean (+ a separate tradeAgreementCode)
  additionalParameters?: Record<string, any>;   // should be additionalInputs
}
```

**Note:** even *before* PR #3, this request was already returning bad results — the legacy `weight` field was silently stripped (the API expected `weightKg`), and `tradeAgreementCertificate: "USMCA"` was failing class-validator's `@IsBoolean()` and was likely being dropped too. So the page has been quietly broken for a while; PR #3 just made it loud (400 instead of incorrect result).

### 1.3 Recommended fix

Two options, both small:

**Option A (recommended) — fix the legacy page to send the right shape.**
Edit [`calculator-home.page.ts:309-317`](../../../hts-ui/projects/website/src/app/features/calculator/pages/calculator-home.page.ts) and [`calculation.models.ts:8-17`](../../../hts-ui/projects/shared/src/lib/models/calculation.models.ts):

```ts
// calculation.models.ts
export interface CalculationRequest {
  htsNumber: string;
  countryOfOrigin: string;
  declaredValue: number;
  currency?: string;
  weightKg?: number;                       // renamed
  quantity?: number;
  tradeAgreementCode?: string;             // separate code
  tradeAgreementCertificate?: boolean;     // and boolean flag
  additionalInputs?: Record<string, any>;  // renamed
}

// calculator-home.page.ts
const request: CalculationRequest = {
  htsNumber: data.htsNumber,
  countryOfOrigin: data.countryOfOrigin,
  declaredValue: data.declaredValue,
  currency: data.currency || 'USD',
  weightKg: data.weight,                                     // map the form field
  quantity: data.quantity,
  tradeAgreementCode: data.tradeAgreementCertificate || undefined,
  tradeAgreementCertificate: !!data.tradeAgreementCertificate,
};
```

**Option B — retire the legacy page.** It immediately navigates to `/v2/calculator/results` (the V2 results page) after submit anyway, which is inconsistent. If the team agrees V2 is the canonical UX, redirect `/v2/calculator` → `/calculator` and delete `features/calculator/` entirely.

Either way: do this **before merging to a deployed branch**, or roll back the controller-scoped `forbidNonWhitelisted: true` until it's done. PR #3 is a hard breaking change for `/v2/calculator`.

### 1.4 Optional: relax DTO temporarily

If you want to deploy PR #3 immediately and fix hts-ui as a follow-up, gate the strictness behind an env flag — but I don't recommend this; clean fix is the right move.

---

## 2. PR #2 — duty display mode. End-to-end consistency check.

The new merchant setting flows through five places. All five line up:

| Layer | File | What it does | OK? |
|---|---|---|---|
| **Database** | [`src/db/migrations/1778175965979-add-duty-display-mode.ts`](../../src/db/migrations/1778175965979-add-duty-display-mode.ts) | `ALTER TABLE shopify_sessions ADD duty_display_mode varchar(20) NOT NULL DEFAULT 'ddu'` | 🟢 |
| **Entity** | [`src/modules/shopify-app/entities/shopify-session.entity.ts:44-45`](../../src/modules/shopify-app/entities/shopify-session.entity.ts) | `@Column('varchar', { length: 20, default: 'ddu' }) dutyDisplayMode: string` — camelCase → `duty_display_mode` via CustomNamingStrategy | 🟢 |
| **Admin API** | [`src/modules/shopify-app/controllers/shopify-admin.controller.ts`](../../src/modules/shopify-app/controllers/shopify-admin.controller.ts) | `GET/POST /shopify/api/settings`, validates against `['ddu','ddp','disabled']` | 🟢 |
| **Admin UI** | [`src/modules/shopify-app/controllers/shopify-auth.controller.ts`](../../src/modules/shopify-app/controllers/shopify-auth.controller.ts) | New "Settings" tab in the embedded admin HTML | 🟢 |
| **Widget API** | [`src/modules/widget/controllers/widget-api.controller.ts:199-205`](../../src/modules/widget/controllers/widget-api.controller.ts) | `/widget/checkout/estimate` response now includes `dutyDisplayMode` from the shop's session, default `'ddu'` | 🟢 |
| **Storefront consumer** | [`hts-shopify-extension/extensions/hts-duty-estimate/src/Checkout.jsx:111-115`](../../../hts-shopify-extension/extensions/hts-duty-estimate/src/Checkout.jsx) | Reads `estimate.dutyDisplayMode`, defaults to `'ddu'`, hides banner if `'disabled'`, changes copy for `'ddp'` | 🟢 |

### 2.1 Things to verify on deploy

1. **Run migration BEFORE the new build serves traffic.** Order:
   - `scripts/run-migration.sh` on the prod DB (applies `AddDutyDisplayMode1778175965979`)
   - Then deploy the new `hts-service` image
   - There's no `migrationsRun: true` in the data source ([`data-source.ts:23`](../../src/db/data-source.ts) has `synchronize: false`), so migrations don't run on boot — they're explicit.
   - If the new build boots first, every `sessionRepository.save(session)` and any read that selects all columns will fail until the migration completes.

2. **Storefront cache.** The Shopify checkout extension is a separate deploy artifact. Older deployed extension versions don't know about `dutyDisplayMode` — they'll just ignore it, which is fine. Newer extension versions (with the `Checkout.jsx` change above) require the backend to return `dutyDisplayMode` — which it now does for all shops (defaulted to `'ddu'`). So both directions are backward-compatible.

3. **`disabled` mode is `null` from the widget side.** The extension code is `if (mode === 'disabled') return null;` — so the banner disappears for `disabled` shops. Worth a smoke-test that an existing shop set to `disabled` actually sees no banner.

### 2.2 Minor gaps worth knowing about

- **No history/audit log** for who flipped the setting. `POST /shopify/api/settings` just overwrites. Probably fine; flag if compliance cares.
- **No `dutyDisplayMode` constraint at the DB level** — only the entity column type (`varchar(20)`). The valid set `['ddu','ddp','disabled']` is enforced at the controller. If someone writes via raw SQL or a different code path, garbage values can land. Could add a CHECK constraint, but not blocking.
- **Migration is reversible** — `down()` drops the column cleanly. Good.

---

## 3. Other backend changes on `main` that could affect frontends

`git log origin/main` since `5f2852d` (the last "stable" point before this batch):

```
4749a44 Merge pull request #2 from chengwang-cc/feat/billing-webhook-tariff-rates
8a91433 Add duty display mode setting for Shopify merchants
8ae9096 Merge pull request #3 from chengwang-cc/fix/calculator-public-country-validation
8cb3575 Public calculator API: validate countryOfOrigin strictly
3f4648c shopify integration
30a5c40 update
bac6779 feat(lookup): make image classification endpoints public for unauthenticated access
b609ecd add more rules
395450b fix(docker): add curl to runtime image for container health check
45a50fa Merge PR #1
f00b3a1 Stripe webhook, tariff-rates endpoint, billing & search improvements
```

Out of scope for this review (different PRs / not part of #2 and #3), but flagging since they're on the same deploy:

- **`bac6779 make image classification endpoints public for unauthenticated access`** — if image classification was previously authenticated, frontends that were passing an API key are still fine (extra headers are ignored); frontends that weren't are now also fine. No regression expected, but worth verifying with the team that "public" is intentional.
- **`f00b3a1 Stripe webhook, tariff-rates endpoint, billing & search improvements`** — the `/api/v1/calculator/tariff-rates` endpoint is hit by [`CalculatorV2Service.fetchQuickRate()`](../../../hts-ui/projects/website/src/app/features/calculator-v2/services/calculator-v2.service.ts) (line 75). If that PR landed first and is already in prod, no concern; if it landed simultaneously, smoke-test the V2 calculator quick-rate column.

---

## 4. Frontend changes to make alongside (or instead of) backend hot-patch

| What | Why | Effort |
|---|---|---|
| 🔴 **Fix `CalculationRequest` shape in `hts-ui/projects/shared/.../calculation.models.ts` + the legacy `calculator-home.page.ts` to send `weightKg`, `tradeAgreementCode`, boolean `tradeAgreementCertificate`** | Restores `/v2/calculator` page. **Required.** | ~10 lines |
| 🟡 Add a hidden `name="off"` autocomplete attr or similar to country fields if browsers are autofilling country names | Defensive — prevents a user accidentally typing "China" into a country code field on calculators that use a free-text input | Trivial |
| 🟡 Update `hts-web2/docs/2026-05-11/1019_dutiful-calculator-origin-country-debug.md` partner guide to reflect the **new** stricter validation (it currently describes the lenient world) | Partners reading the doc should now know they'll get 400s for misnamed fields, not silent fall-through | A few paragraphs |
| 🟢 Optional: drop `additionalParameters`, `weight` and the string `tradeAgreementCertificate` from `CalculationRequest` entirely — they're legacy and not in the API anymore | Type cleanup | 5 mins |

---

## 5. Recommended next steps (in priority order)

1. **Hot-patch hts-ui legacy calculator page** (Option A in §1.3). Without this, `/v2/calculator` is broken in prod the moment `hts-service:main` deploys.
2. **Coordinate the deploy:** run the duty-display-mode migration on prod DB first, then push the new `hts-service` image.
3. **Smoke-test after deploy:**
   - `https://www.usahts.com/calculator` (V2) — submit a CN-origin laptop, confirm `additionalTariffs` populated, response `meta.countryOfOrigin === "CN"`.
   - `https://www.usahts.com/v2/calculator` (legacy) — verify it submits cleanly (assumes you applied step 1).
   - `https://hts.proto.com/` tariff calculator (hts-web2) — same smoke test.
   - Any merchant Shopify admin → Settings tab → flip to `disabled` → confirm the storefront banner disappears.
4. **Update the Dutiful partner guide** to reflect the new validation semantics; tell Dutiful directly via Slack with the new error messages they should expect.
5. **Decide on the legacy `/v2/calculator` page's future** — fix-in-place vs redirect-to-v2.

---

## Appendix — DTO + request shapes referenced

**Server DTO** ([`CalculatePublicDto`](../../src/modules/public-api/v1/dto/calculate-public.dto.ts)):

```
htsNumber           string, ≤20
countryOfOrigin     string, NotEmpty, /^[A-Za-z]{2}$/
declaredValue       number, >0
currency?           string, ≤3
weightKg?           number, ≥0
quantity?           number, ≥0
quantityUnit?       string, ≤50
entryDate?          string
tradeAgreementCode? string, ≤30
tradeAgreement?     string, ≤30      (legacy alias)
tradeAgreementCertificate? boolean
claimPreferential?  boolean           (legacy alias)
htsVersion?         string, ≤50
additionalInputs?   object
```

**Anything else** in the body → 400 with `property X should not exist`.
