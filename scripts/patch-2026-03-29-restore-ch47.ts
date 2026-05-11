#!/usr/bin/env ts-node
/**
 * Restore ch.47 penalties lost during 2026-03-29 seed reset.
 *
 * The seed-intent-rules.ts script reset 841 DB rules to intent-rules.ts baseline,
 * which was missing several improvements from the 03-12 patch series.
 *
 * This patch restores:
 * 1. OUTERWEAR_INTENT: add ch.47/56/51/52 penalties (keep equalized ch61/ch62)
 * 2. DRESS_SKIRT_INTENT: add ch.47/56 penalties
 * 3. PANTS_JEANS_INTENT: add ch.47/56 penalties, add 'shorts'/'overalls' to anyOf
 * 4. KNITWEAR_INTENT: add ch.47/56 penalties, add 'cardigan'/'cardigans' to anyOf
 * 5. APPAREL_INTENT: add ch.47/56 penalties, add extended garment tokens
 * 6. COTTON_APPAREL: extend with more garment keywords
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-2026-03-29-restore-ch47.ts
 */
import 'tsconfig-paths/register';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { IntentRuleService } from '../src/modules/lookup/services/intent-rule.service';
import type { IntentRule } from '../src/modules/lookup/services/intent-rules';

async function patch(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['warn', 'error'] });
  try {
    const svc = app.get(IntentRuleService, { strict: false });
    const allRules = svc.getAllRules() as IntentRule[];

    type Patch = { rule: IntentRule; priority: number };
    const patches: Patch[] = [];

    // ── 1. OUTERWEAR_INTENT: add ch.47/56/51/52 penalties ─────────────────────
    {
      const existing = allRules.find(r => r.id === 'OUTERWEAR_INTENT');
      if (existing) {
        const penalties = existing.penalties ?? [];
        const hasC47 = penalties.some(p => (p as any).chapterMatch === '47');
        if (!hasC47) {
          patches.push({
            priority: 39,
            rule: {
              ...existing,
              penalties: [
                ...penalties,
                { delta: 0.95, chapterMatch: '47' } as any,
                { delta: 0.75, chapterMatch: '56' } as any,
                { delta: 0.65, chapterMatch: '51' } as any,
                { delta: 0.65, chapterMatch: '52' } as any,
              ],
            },
          });
          console.log('OUTERWEAR_INTENT: adding ch.47/56/51/52 penalties');
        } else {
          console.log('OUTERWEAR_INTENT: already has ch.47 penalty, skipping');
        }
      } else {
        console.log('OUTERWEAR_INTENT: not found');
      }
    }

    // ── 2. DRESS_SKIRT_INTENT: add ch.47/56 penalties ─────────────────────────
    {
      const existing = allRules.find(r => r.id === 'DRESS_SKIRT_INTENT');
      if (existing) {
        const penalties = existing.penalties ?? [];
        const hasC47 = penalties.some(p => (p as any).chapterMatch === '47');
        if (!hasC47) {
          patches.push({
            priority: 40,
            rule: {
              ...existing,
              penalties: [
                ...penalties,
                { delta: 0.95, chapterMatch: '47' } as any,
                { delta: 0.75, chapterMatch: '56' } as any,
              ],
            },
          });
          console.log('DRESS_SKIRT_INTENT: adding ch.47/56 penalties');
        } else {
          console.log('DRESS_SKIRT_INTENT: already has ch.47 penalty, skipping');
        }
      } else {
        console.log('DRESS_SKIRT_INTENT: not found');
      }
    }

    // ── 3. PANTS_JEANS_INTENT: add ch.47/56 penalties + shorts/overalls ────────
    {
      const existing = allRules.find(r => r.id === 'PANTS_JEANS_INTENT');
      if (existing) {
        const penalties = existing.penalties ?? [];
        const hasC47 = penalties.some(p => (p as any).chapterMatch === '47');
        const anyOf = existing.pattern.anyOf ?? [];
        const hasShorts = anyOf.includes('shorts');
        if (!hasC47 || !hasShorts) {
          const newAnyOf = hasShorts ? anyOf : [...anyOf, 'shorts', 'overalls'];
          patches.push({
            priority: 41,
            rule: {
              ...existing,
              pattern: { ...existing.pattern, anyOf: newAnyOf },
              penalties: hasC47 ? penalties : [
                ...penalties,
                { delta: 0.95, chapterMatch: '47' } as any,
                { delta: 0.75, chapterMatch: '56' } as any,
              ],
            },
          });
          console.log(`PANTS_JEANS_INTENT: ${!hasC47 ? 'adding ch.47/56 penalties' : ''} ${!hasShorts ? '+ shorts/overalls to anyOf' : ''}`);
        } else {
          console.log('PANTS_JEANS_INTENT: already updated, skipping');
        }
      } else {
        console.log('PANTS_JEANS_INTENT: not found');
      }
    }

    // ── 4. KNITWEAR_INTENT: add ch.47/56 penalties + cardigan ─────────────────
    {
      const existing = allRules.find(r => r.id === 'KNITWEAR_INTENT');
      if (existing) {
        const penalties = existing.penalties ?? [];
        const hasC47 = penalties.some(p => (p as any).chapterMatch === '47');
        const anyOf = existing.pattern.anyOf ?? [];
        const hasCardigan = anyOf.includes('cardigan');
        if (!hasC47 || !hasCardigan) {
          const newAnyOf = hasCardigan ? anyOf : [...anyOf, 'cardigan', 'cardigans'];
          patches.push({
            priority: 42,
            rule: {
              ...existing,
              pattern: { ...existing.pattern, anyOf: newAnyOf },
              penalties: hasC47 ? penalties : [
                ...penalties,
                { delta: 0.95, chapterMatch: '47' } as any,
                { delta: 0.75, chapterMatch: '56' } as any,
              ],
            },
          });
          console.log(`KNITWEAR_INTENT: ${!hasC47 ? 'adding ch.47/56 penalties' : ''} ${!hasCardigan ? '+ cardigan to anyOf' : ''}`);
        } else {
          console.log('KNITWEAR_INTENT: already updated, skipping');
        }
      } else {
        console.log('KNITWEAR_INTENT: not found');
      }
    }

    // ── 5. APPAREL_INTENT: add ch.47/56 penalties + extended tokens ───────────
    {
      const existing = allRules.find(r => r.id === 'APPAREL_INTENT');
      if (existing) {
        const penalties = existing.penalties ?? [];
        const hasC47 = penalties.some(p => (p as any).chapterMatch === '47');
        const anyOf = existing.pattern.anyOf ?? [];
        const hasBlouse = anyOf.includes('blouse');
        if (!hasC47 || !hasBlouse) {
          const newAnyOf = hasBlouse ? anyOf : [
            ...anyOf,
            'blouse', 'blouses', 'tunic', 'tunics', 'vest', 'vests',
          ];
          const newPenalties = hasC47 ? penalties : [
            ...penalties,
            { delta: 0.95, chapterMatch: '47' } as any,
            { delta: 0.70, chapterMatch: '56' } as any,
          ];
          patches.push({
            priority: 5,
            rule: {
              ...existing,
              pattern: { ...existing.pattern, anyOf: newAnyOf },
              penalties: newPenalties,
            },
          });
          console.log(`APPAREL_INTENT: ${!hasC47 ? 'adding ch.47/56 penalties' : ''} ${!hasBlouse ? '+ extended tokens' : ''}`);
        } else {
          console.log('APPAREL_INTENT: already updated, skipping');
        }
      } else {
        console.log('APPAREL_INTENT: not found');
      }
    }

    // ── 6. COTTON_APPAREL: extend anyOf with all garment keywords ──────────────
    {
      const existing = allRules.find(r => r.id === 'COTTON_APPAREL');
      if (existing) {
        const anyOf = existing.pattern.anyOf ?? [];
        const hasHoodie = anyOf.includes('hoodie');
        const hasPants = anyOf.includes('pants');
        if (!hasHoodie || !hasPants) {
          const extended = [
            ...new Set([
              ...anyOf,
              'jacket', 'jackets', 'coat', 'coats', 'outerwear',
              'dress', 'dresses', 'skirt', 'skirts',
              'pants', 'jeans', 'trousers', 'shorts', 'overalls', 'leggings',
              'shirt', 'shirts', 'tshirt', 'tshirts', 'tee', 'blouse', 'tunic',
              'sweater', 'sweaters', 'hoodie', 'hoodies', 'sweatshirt', 'sweatshirts',
              'pullover', 'pullovers', 'cardigan', 'cardigans',
            ]),
          ];
          patches.push({
            priority: 6,
            rule: {
              ...existing,
              pattern: { ...existing.pattern, anyOf: extended },
            },
          });
          console.log('COTTON_APPAREL: extending anyOf with garment keywords');
        } else {
          console.log('COTTON_APPAREL: already updated, skipping');
        }
      } else {
        console.log('COTTON_APPAREL: not found');
      }
    }

    console.log(`\nApplying ${patches.length} patches...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`  ❌ ${rule.id}: ${msg}`);
      }
    }
    console.log(`\nPatch complete. Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
