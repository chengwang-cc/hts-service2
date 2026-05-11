# Deploy Runbook — PR #2 (duty display mode) + PR #3 (calculator validation)

**Date:** 2026-05-11
**Audience:** whoever rolls `hts-service:main` to prod.
**Companion doc:** `1108_post-merge-deep-review-pr2-pr3.md` (deep review with the why).

---

## 0. Pre-flight check (5 minutes, do this first)

- [ ] **hts-ui PR #1** ([`fix/legacy-calculator-request-shape`](https://github.com/chengwang-cc/hts-ui/pull/1)) is merged to `main` AND its build has been deployed.
  *Why:* without it, the legacy `/v2/calculator` page returns 400 on every submit the moment this hts-service goes live.
- [ ] You have shell access to the prod DB host (or whatever bastion runs migrations).
- [ ] You have a recent DB snapshot/backup (the migration is reversible, but defense in depth).
- [ ] `gh pr list -R chengwang-cc/hts-service2 --state open` shows no other unmerged dependencies.

---

## 1. Apply the database migration

The migration is **manual** — `data-source.ts` has `synchronize: false` and no `migrationsRun: true`, so booting the new image does NOT auto-apply.

### 1.1 Verify locally / staging first

```bash
cd hts-service
git pull origin main
npm install                       # ensure tooling is current
scripts/run-migration.sh          # against staging DB credentials in .env
```

Expected output ends with `Migration AddDutyDisplayMode1778175965979 has been executed successfully.`

Verify the column landed:

```sql
\d+ shopify_sessions
-- expect: duty_display_mode character varying(20) DEFAULT 'ddu'::character varying NOT NULL
```

Confirm existing rows are backfilled to `'ddu'` (the DEFAULT clause handles this for NOT NULL columns):

```sql
SELECT duty_display_mode, COUNT(*)
FROM shopify_sessions
GROUP BY duty_display_mode;
-- expect every existing row → 'ddu'
```

### 1.2 Run on prod

Same command, prod DB credentials in env:

```bash
cd hts-service
git pull origin main
scripts/run-migration.sh
```

**Hard requirement:** this step completes BEFORE step 2. Order matters — if the new image boots first, every `sessionRepository.save(session)` crashes with `column "duty_display_mode" does not exist`.

### 1.3 Rollback plan

If the migration fails partway:

```bash
npx typeorm migration:revert -d src/db/data-source.ts
# revert is wired in 1778175965979-add-duty-display-mode.ts:10-12 → DROP COLUMN
```

The drop is safe because no app code has run against the column yet.

---

## 2. Deploy the new `hts-service` image

Standard process (whatever you normally do). The two relevant commits on `main`:

```
4749a44 Merge pull request #2 from chengwang-cc/feat/billing-webhook-tariff-rates
8ae9096 Merge pull request #3 from chengwang-cc/fix/calculator-public-country-validation
```

After traffic is on the new image, do step 3 immediately.

---

## 3. Post-deploy smoke tests

Run [`scripts/smoke-test-calculator-public-api.sh`](../../scripts/smoke-test-calculator-public-api.sh) from this PR (companion script). Quick reference:

```bash
export HTS_API_BASE=https://api.usahts.com      # or staging
export HTS_API_KEY=hts_prod_xxxxxxxx
scripts/smoke-test-calculator-public-api.sh
```

Expected: **8 passes, 0 fails.** The script covers:

1. Happy path — `countryOfOrigin: "CN"` returns 200 + non-zero `additionalTariffs`.
2. Country-changes-rates — `CN` vs `VN` on the same HTS yields different `additionalTariffs`.
3. Case-insensitive — `cn` is accepted and normalized to `CN` in `meta.countryOfOrigin`.
4. Missing field — empty `countryOfOrigin` returns 400 with `countryOfOrigin is required`.
5. Wrong format — `"China"` returns 400 with the ISO-2 regex message.
6. Wrong field name — `country: "CN"` returns 400 with `property country should not exist`.
7. Extra unknown field — returns 400 (proves `forbidNonWhitelisted` is active).
8. `meta.countryOfOrigin` echoes the normalized value on the success path.

Then do the **manual** checks:

- [ ] `https://www.usahts.com/calculator` (V2): submit CN-origin laptop @ $1000; confirm `additionalTariffs > 0`.
- [ ] `https://www.usahts.com/v2/calculator` (legacy, requires hts-ui PR #1 merged + deployed): submit with USMCA selected; confirm no `400`.
- [ ] `https://hts.proto.com/` tariff calculator (hts-web2): submit a CN-origin item; confirm rates show.
- [ ] **Shopify duty banner** — pick one merchant with an active install:
  - Default install → banner shows with "Estimated US Import Duties & Taxes" heading (mode `ddu`).
  - In the embedded admin → Settings tab → switch to `disabled` → reload the storefront cart → banner disappears.
  - Switch to `ddp` → banner heading changes to "US Import Duties & Taxes (Pre-paid)" with the DDP disclaimer copy.

---

## 4. Communications

- [ ] Slack the Dutiful integrator: send the link to the updated `hts-web2/docs/2026-05-11/.../dutiful-calculator-strict-validation.md` (companion hts-web2 PR). Note that 400s on misnamed fields are new and will surface their bug immediately rather than silently returning the general rate.
- [ ] If there are other public-API partners beyond Dutiful, give them the same heads-up. (Check the `api_keys` table or whatever tracks issued keys.)

---

## 5. If something goes wrong

| Symptom | Likely cause | First action |
|---|---|---|
| Every Shopify session save errors `column "duty_display_mode" does not exist` | Migration didn't run | Run `scripts/run-migration.sh` |
| All calculator API requests return 500 | New image broken or DB partially migrated | Roll back the image; if migration partial, `migration:revert` |
| One partner reports 400s after deploy | They're sending an unknown field or wrong country format | Show them the new error message — it self-describes the fix; share the updated Dutiful doc |
| `/v2/calculator` page in www.usahts.com returns 400 | hts-ui PR #1 not deployed | Ship hts-ui first; or temporarily revert hts-service PR #3 |

Roll-back ordering if you have to back out the whole batch: **revert hts-service deploy first**, then `migration:revert` (in that order — the migration must outlive any running app code that depends on it).
