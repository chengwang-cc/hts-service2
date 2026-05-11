# Deploy Runbook — AWS Corrections (Supersedes 1114 doc)

**Date:** 2026-05-11
**Supersedes:** [`1114_deploy-runbook-pr2-pr3.md`](./1114_deploy-runbook-pr2-pr3.md). The 1114 doc was written without knowledge of the AWS prod setup; this corrects the migration and deploy steps to match what's actually in [`hts-devops/platforms/hts/scripts/`](../../../hts-devops/platforms/hts/scripts/) and the existing prod runbook ([`docs/2026-03-27/1501_hts-aws-runbook.md`](../../../docs/2026-03-27/1501_hts-aws-runbook.md)). Use **this** doc for the actual rollout; keep 1114 around only for the conceptual ordering / rollback logic.

---

## What was wrong in the 1114 doc

| 1114 said | Reality |
|---|---|
| "Run `scripts/run-migration.sh` against prod DB credentials in env" | Prod RDS is in a private VPC. You can't reach it from a workstation without the **SSH tunnel via the jumpbox** (`hts-devops/.../db-tunnel.sh`). |
| "Migrations don't run on boot — they're explicit" | Correct conclusion but for the wrong reason. The `data-source.ts` has `synchronize: false` AND there is **no `migrationsRun: true`** AND the Dockerfile `CMD` is just `node dist/main.js` — no migration step is wrapped into container startup. Migrations are fully manual. |
| "Deploy the new `hts-service` image (standard process)" | The actual command is `./deploy-backend-ecs.sh` in `hts-devops/platforms/hts/scripts/`. It builds, pushes to ECR, forces a new ECS deployment, and waits for `services-stable`. |
| Rollback section referenced `migration:revert` directly | In prod, you have to be tunneled in first to reach the DB. Rollback of the ECS image is `./rollback-backend-ecs.sh`. |

---

## Corrected end-to-end procedure

### Pre-flight (~5 min)

```bash
cd hts-devops/platforms/hts/scripts

# 1. Baseline health
./hts-status.sh

# 2. Confirm jumpbox SSH key works
ssh -i ~/.ssh/edge-server-key.pem -o ConnectTimeout=5 ec2-user@16.148.60.5 'echo ok'
# expect: ok
```

Also confirm:

- [ ] **hts-ui PR #1** (`fix/legacy-calculator-request-shape`) is merged AND deployed via `./deploy-frontend.sh`. Without it, `/v2/calculator` returns 400 on every submit as soon as the hts-service deploy goes live.
- [ ] Recent RDS snapshot exists (auto-snapshots are daily; manual snapshot if you want one right now):
  ```bash
  aws --profile proto rds create-db-snapshot \
    --region us-west-2 \
    --db-instance-identifier poc-edge-postgres \
    --db-snapshot-identifier pre-duty-display-migration-$(date +%Y%m%d-%H%M)
  ```

### Step 1 — Apply the migration via the SSH tunnel

```bash
# 1. Open the tunnel (background so step 2 can run from another shell)
cd hts-devops/platforms/hts/scripts
./db-tunnel.sh --background
# Forwards localhost:15432 → poc-jumpbox → RDS:5432

# 2. Configure hts-service .env to point at the tunnel
cd ../../../../hts-service
# Edit .env to set (or override):
#   DB_HOST=127.0.0.1
#   DB_PORT=15432
#   DB_NAME=hts
#   DB_USERNAME=hts_app
#   DB_PASSWORD=HtsApp2026Secure
#   DB_SSL=true                  # RDS requires SSL even via tunnel
# (If your prod .env keeps these locked away — copy to .env.prod-tunnel and use that.)

# 3. Run the migration
./scripts/run-migration.sh
# Expect last line: Migration AddDutyDisplayMode1778175965979 has been executed successfully.

# 4. Verify
PGPASSWORD=HtsApp2026Secure psql \
  "host=127.0.0.1 port=15432 dbname=hts user=hts_app sslmode=require" \
  -c "\d+ shopify_sessions" | grep duty_display_mode
# expect: duty_display_mode | character varying(20) | ... not null default 'ddu'::character varying

PGPASSWORD=HtsApp2026Secure psql \
  "host=127.0.0.1 port=15432 dbname=hts user=hts_app sslmode=require" \
  -c "SELECT duty_display_mode, count(*) FROM shopify_sessions GROUP BY duty_display_mode;"
# expect: every existing row defaulted to 'ddu'

# 5. Close the tunnel
pkill -f "L 15432:poc-edge-postgres"
```

**Hard requirement:** complete step 1 before step 2. If the new ECS task starts before the column exists, every Shopify session save crashes with `column "duty_display_mode" does not exist`.

### Step 2 — Deploy the new `hts-service` image

```bash
cd hts-devops/platforms/hts/scripts
./deploy-backend-ecs.sh
# Builds linux/amd64, pushes to ECR :latest, registers new task def, force-new-deployment, waits for services-stable.
```

Watch the deploy:

```bash
./hts-logs.sh --tail
# In another shell, periodically:
./hts-status.sh
```

`./hts-status.sh` should end with all-green: ECS running 1/1, ALB target healthy, RDS available, recent error count zero.

### Step 3 — Smoke test against prod

```bash
cd hts-service
export HTS_API_BASE=https://api.usahts.com
export HTS_API_KEY=<your-prod-api-key>
./scripts/smoke-test-calculator-public-api.sh
# Expected: 8 passed, 0 failed
```

If anything fails: don't proceed to step 4. Investigate, possibly roll back (see below).

Then the manual checks from the 1114 doc §3:

- `https://www.usahts.com/calculator` (V2) — CN-origin laptop $1000 → `additionalTariffs > 0`
- `https://www.usahts.com/v2/calculator` (legacy) — USMCA select → 200 (requires hts-ui PR #1 deployed)
- `https://hts.proto.com/` tariff calculator (hts-web2) — CN-origin item → rates show
- Pick one Shopify merchant → admin → Settings → flip `disabled` → reload storefront cart → banner disappears

### Step 4 — Comms

- [ ] Slack the Dutiful integrator with the link to [`hts-web2/docs/2026-05-11/1116_dutiful-calculator-strict-validation-update.md`](../../../hts-web2/docs/2026-05-11/1116_dutiful-calculator-strict-validation-update.md) (once that PR is merged).
- [ ] Note in the engineering channel that the duty-display-mode migration was applied and the calculator API is now stricter.

---

## Rollback playbook (in order if you need to revert)

### Roll back the ECS image first

```bash
cd hts-devops/platforms/hts/scripts
./rollback-backend-ecs.sh
# Or: ./rollback-backend-ecs.sh --revision N  to a specific task def revision
```

This puts the previous image (which doesn't know about `duty_display_mode`) back in front of traffic. Confirm health returns:

```bash
./hts-status.sh
curl https://api.usahts.com/api/v1/auth/health
```

### Then roll back the migration (only if needed)

The old image doesn't read `duty_display_mode`, so leaving the column in place is **safe**. Only revert if you specifically need the column gone:

```bash
cd hts-devops/platforms/hts/scripts
./db-tunnel.sh --background

cd ../../../../hts-service
# .env still pointing at 127.0.0.1:15432:
npx typeorm migration:revert -d src/db/data-source.ts
# Runs the down() in 1778175965979-add-duty-display-mode.ts → DROP COLUMN duty_display_mode

pkill -f "L 15432:poc-edge-postgres"
```

**Never** revert the migration while the new image is still running — that's the only ordering that causes data loss / crashes.

---

## What from the 1114 doc still applies

- The **eight smoke tests** in [`scripts/smoke-test-calculator-public-api.sh`](../../scripts/smoke-test-calculator-public-api.sh) — unchanged, AWS-agnostic, run from any workstation with an API key.
- The **deep-review doc** [`1108_post-merge-deep-review-pr2-pr3.md`](./1108_post-merge-deep-review-pr2-pr3.md) — still the authoritative "why" for both PRs.
- The **ordering principle**: migration → deploy → smoke test → comms. Same here.
- The **dependency on hts-ui PR #1** — still blocking; deploying hts-service without that hts-ui change will 400 every legacy `/v2/calculator` submit.

---

## Quick reference — where each tool lives

| Tool | Path |
|---|---|
| ECS deploy | `hts-devops/platforms/hts/scripts/deploy-backend-ecs.sh` |
| ECS rollback | `hts-devops/platforms/hts/scripts/rollback-backend-ecs.sh` |
| Frontend deploy (hts-ui) | `hts-devops/platforms/hts/scripts/deploy-frontend.sh` |
| DB SSH tunnel | `hts-devops/platforms/hts/scripts/db-tunnel.sh` |
| Run migration (local, expects .env) | `hts-service/scripts/run-migration.sh` |
| Generate new migration | `hts-service/scripts/generate-migration.sh` |
| Status dashboard | `hts-devops/platforms/hts/scripts/hts-status.sh` |
| Logs | `hts-devops/platforms/hts/scripts/hts-logs.sh` |
| Smoke test the public calculator API | `hts-service/scripts/smoke-test-calculator-public-api.sh` (this PR) |
| Authoritative prod runbook | `docs/2026-03-27/1501_hts-aws-runbook.md` |
