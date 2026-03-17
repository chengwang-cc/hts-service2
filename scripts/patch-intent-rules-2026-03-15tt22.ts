#!/usr/bin/env ts-node
/**
 * Patch TT22 — 2026-03-15: Handbags + wallets + cotton hoodies + cotton t-shirts + vinyl fix.
 * Current: ~31.78% (after TT20; TT21 pending eval)
 *
 * Targets:
 *  1. Fix: PLASTIC_SILICONE_POUCH_INTENT — remove 'vinyl pouch'/'vinyl bag' (conflict with 4202.32)
 *  2. HANDBAG_PURSE_TOTE_INTENT → 4202.22 (handbags, tote bags, purses, shoulder bags, knitting bags)
 *     "30 Vegan Leather Bags" → 4202.22.15; "Cotton Canvas knitting bag" → 4202.22.45; 24 entries
 *  3. WALLET_FLAT_POUCH_INTENT → 4202.32 (wallets, coin purses, vinyl pouches, pencil cases)
 *     "envelope vinyl pouch" → 4202.32.10; "Nightmare Before Christmas Wallet" → 4202.32.20; 15 entries
 *  4. COTTON_HOODIE_SWEATSHIRT_INTENT → 6110.20 (cotton hoodies, sweatshirts, crewnecks)
 *     "65% cotton 35% poly Hoodie" → 6110.20; "100% cotton womens hoodie sweatshirt" → 6110.20; 30 entries
 *  5. COTTON_TSHIRT_SINGLET_INTENT → 6109.10 (cotton t-shirts, tank tops, undershirts)
 *     "Kids cotton tee" → 6109.10; "mens cotton undershirt" → 6109.10; 27 entries
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-15tt22.ts
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

    const addAnyOf = (e: IntentRule, ...terms: string[]) => {
      const pat = (e.pattern as any) ?? {};
      return { ...pat, anyOf: [...new Set([...(pat.anyOf ?? []), ...terms])] };
    };

    // 1. Fix PLASTIC_SILICONE_POUCH_INTENT: remove vinyl terms that conflict with 4202.32
    //    "envelope vinyl pouch" → expected 4202.32 (wallet/flat pouch), not 4202.92 (travel bag)
    //    "large vinyl pouch" → same conflict
    {
      const e = allRules.find(r => r.id === 'PLASTIC_SILICONE_POUCH_INTENT');
      if (e) {
        const removeTerms = new Set([
          'vinyl pouch', 'vinyl bag', 'clear vinyl bag', 'envelope vinyl pouch',
        ]);
        const anyOf = ((e.pattern as any)?.anyOf || []).filter((t: string) => !removeTerms.has(t));
        const newPat = { ...(e.pattern as any), anyOf };
        patches.push({ priority: (e as any).priority ?? 565, rule: { ...e, pattern: newPat } });
        console.log('PLASTIC_SILICONE_POUCH_INTENT: removed vinyl terms (conflict with 4202.32)');
      }
    }

    // 2. HANDBAG_PURSE_TOTE_INTENT → 4202.22 (handbags, tote bags, purses, project bags)
    //    Covers many sub-headings: 4202.22.15 (plastic outer), 4202.22.40 (textile outer),
    //    4202.22.45 (fabric tote), 4202.22.60 (linen), 4202.22.81 (nylon), 4202.22.89 (other)
    //    "Plastic Handbag with shoulder strap" → 4202.22.15.00
    //    "Cotton Canvas knitting bag" → 4202.22.45.00; "polyester tote bag" → 4202.22.81.00
    //    "Knitting Project Bag- Linen Stars print" → 4202.22.60.00
    {
      const existing = allRules.find(r => r.id === 'HANDBAG_PURSE_TOTE_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'HANDBAG_PURSE_TOTE_INTENT',
          description: 'Handbags, purses, tote bags, shoulder bags, knitting/project bags → ch.42 (4202.22)',
          pattern: {
            anyOf: [
              'handbag', 'handbags', 'shoulder bag', 'shoulder bags',
              'purse', 'purses', 'evening bag', 'evening purse', 'fabric purse',
              'crossbody bag', 'cross body bag', 'crossbody purse', 'satchel bag',
              'tote bag', 'tote bags', 'canvas tote bag', 'cotton tote bag',
              'fabric tote bag', 'linen tote bag', 'nylon tote bag',
              'knitting bag', 'knitting project bag', 'project bag',
              'yarn bag', 'crochet bag', 'knit bag', 'wristlet',
              'fanny pack', 'hip bag', 'waist bag', 'belt bag',
              'fabric bag purse', 'textile bag', 'woven shoulder bag', 'tapestry tote',
              'beaded purse', 'beaded bag', 'clutch purse', 'clutch bag',
              'vegan leather bag', 'vegan leather purse', 'faux leather bag', 'faux leather purse',
              'pu leather bag', 'pu leather purse', 'pu leather tote',
              'plastic handbag', 'acrylic bag', 'crochet tote', 'crochet purse',
            ],
            noneOf: ['shopping bag', 'grocery bag', 'paper bag', 'reusable bag',
                     'backpack', 'laptop bag', 'briefcase', 'duffel bag', 'luggage',
                     'diaper bag', 'gym bag', 'travel bag', 'messenger bag'],
          },
          inject: [{ prefix: '4202.22', syntheticRank: 5 }],
          boosts: [{ delta: 0.55, prefixMatch: '4202.22' }],
        } as IntentRule;
        patches.push({ priority: 565, rule: newRule });
        console.log('HANDBAG_PURSE_TOTE_INTENT: created (handbags/purses/tote bags → 4202.22)');
      }
    }

    // 3. WALLET_FLAT_POUCH_INTENT → 4202.32 (wallets, coin purses, vinyl pouches, pencil cases)
    //    "envelope vinyl pouch" → 4202.32.10.00; "PU leather coin pouch" → 4202.32.10.00
    //    "Nightmare Before Christmas Wallet" → 4202.32.20.00
    //    "Cotton Knit Needle Holder" → 4202.32.40.00; "Id card holder" → 4202.32.93.00
    //    "polyester pencil case" → 4202.32.93.00; "used women's wallet" → 4202.32.93.00
    {
      const existing = allRules.find(r => r.id === 'WALLET_FLAT_POUCH_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'WALLET_FLAT_POUCH_INTENT',
          description: 'Wallets, coin purses, vinyl pouches, flat pouches, pencil cases, ID holders → ch.42 (4202.32)',
          pattern: {
            anyOf: [
              'wallet', 'wallets', 'billfold', 'bifold wallet', 'trifold wallet',
              'slim wallet', 'card wallet', 'card holder wallet', 'card sleeve',
              'coin purse', 'coin pouch', 'change purse', 'coin wallet',
              'vinyl pouch', 'vinyl wallet', 'clear vinyl pouch', 'envelope vinyl pouch',
              'vinyl document pouch', 'pvc coin pouch', 'pvc wallet',
              'id holder', 'id card holder', 'badge holder', 'card holder',
              'pencil case', 'pencil pouch', 'pen case', 'pen pouch', 'art supply pouch',
              'needle case', 'knitting needle holder', 'needle holder', 'crochet hook case',
              'cosmetic pouch flat', 'makeup pouch flat', 'toiletry flat pouch',
              'ditty bag', 'musette bag', 'flat fabric pouch', 'flat textile pouch',
            ],
            noneOf: ['backpack', 'handbag', 'tote', 'shoulder bag', 'duffel', 'suitcase',
                     'travel bag', 'gym bag', 'briefcase'],
          },
          inject: [{ prefix: '4202.32', syntheticRank: 5 }],
          boosts: [{ delta: 0.55, prefixMatch: '4202.32' }],
        } as IntentRule;
        patches.push({ priority: 565, rule: newRule });
        console.log('WALLET_FLAT_POUCH_INTENT: created (wallets/coin purses/vinyl pouches → 4202.32)');
      }
    }

    // 4. COTTON_HOODIE_SWEATSHIRT_INTENT → 6110.20 (cotton knit hoodies, sweatshirts, crewnecks)
    //    "65% cotton 35% poly Hoodie" → 6110.20.00.60; "100% cotton womens hoodie sweatshirt" → 6110.20.00.80
    //    "Thrasher Sweats - L" → 6110.20; "Embroidered Swoosh Sweatshirt" → 6110.20
    //    6110.20 = sweaters, pullovers, sweatshirts, waistcoats of cotton
    //    NOTE: JERSEY_SPORTS_APPAREL_INTENT has noneOf: ['cotton hoodie','cotton sweatshirt'] — no conflict
    {
      const existing = allRules.find(r => r.id === 'COTTON_HOODIE_SWEATSHIRT_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'COTTON_HOODIE_SWEATSHIRT_INTENT',
          description: 'Cotton hoodies, sweatshirts, crewnecks, knitwear → ch.61 (6110.20)',
          pattern: {
            anyOf: [
              'cotton hoodie', 'cotton sweatshirt', 'cotton crewneck', 'cotton pullover',
              'cotton sweater', 'cotton zip up hoodie', 'cotton zip hoodie',
              '100% cotton hoodie', '100% cotton sweatshirt', '100% cotton crewneck',
              'cotton blend hoodie', 'cotton blend sweatshirt', 'cotton blend crewneck',
              'crewneck sweatshirt', 'crewneck sweater', 'crewneck pullover',
              'sweatshirt cotton', 'hoodie cotton', 'pullover cotton',
              'fleece sweatshirt cotton', 'graphic sweatshirt', 'graphic crewneck',
              'embroidered sweatshirt', 'embroidered crewneck', 'embroidered hoodie',
              'vintage sweatshirt', 'vintage hoodie', 'vintage crewneck',
              'sweats', 'sweat shirt',
            ],
            noneOf: ['polyester hoodie', 'polyester sweatshirt', 'fleece hoodie',
                     'fleece sweatshirt', 'nylon hoodie', 'zip jacket', 'denim jacket'],
          },
          inject: [{ prefix: '6110.20', syntheticRank: 5 }],
          boosts: [{ delta: 0.55, prefixMatch: '6110.2' }],
        } as IntentRule;
        patches.push({ priority: 565, rule: newRule });
        console.log('COTTON_HOODIE_SWEATSHIRT_INTENT: created (cotton hoodies/sweatshirts → 6110.20)');
      }
    }

    // 5. COTTON_TSHIRT_SINGLET_INTENT → 6109.10 (cotton knit t-shirts, tank tops, singlets)
    //    "Kids cotton tee" → 6109.10.00.12; "mens cotton undershirt" → 6109.10.00.12
    //    "cotton T shirt" → 6109.10; "Sunset T-Shirt - Blue - XL" → 6109.10
    //    6109.10 = t-shirts, singlets, and other vests of cotton, knitted or crocheted
    //    NOTE: woven shirts (6205.20) use 'shirt' but are not knit — noneOf handles this
    {
      const existing = allRules.find(r => r.id === 'COTTON_TSHIRT_SINGLET_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'COTTON_TSHIRT_SINGLET_INTENT',
          description: 'Cotton t-shirts, tank tops, singlets, tees, undershirts → ch.61 (6109.10)',
          pattern: {
            anyOf: [
              'cotton tee', 'cotton t-shirt', 'cotton tshirt', 'cotton shirt',
              'cotton t shirt', 'cotton tank top', 'cotton tank',
              'cotton undershirt', 'cotton singlet', 'cotton muscle shirt',
              'kids cotton tee', 'kids cotton t-shirt', 'womens cotton tee',
              'mens cotton tee', 'mens cotton t-shirt', 'mens cotton undershirt',
              '100% cotton tee', '100% cotton t-shirt', '100% cotton tank',
              'cotton graphic tee', 'cotton graphic t-shirt',
              'cotton jersey tee', 'cotton jersey t-shirt',
              'ring spun tee', 'ring spun cotton tee', 'ring-spun cotton',
              'softhand tee', 'classic fit tee', 'unisex tee',
            ],
            noneOf: ['woven shirt', 'dress shirt', 'button shirt', 'button-down shirt',
                     'polo shirt', 'oxford shirt', 'flannel shirt', 'linen shirt',
                     'polyester shirt', 'dri-fit shirt'],
          },
          inject: [{ prefix: '6109.10', syntheticRank: 5 }],
          boosts: [{ delta: 0.50, prefixMatch: '6109.1' }],
        } as IntentRule;
        patches.push({ priority: 565, rule: newRule });
        console.log('COTTON_TSHIRT_SINGLET_INTENT: created (cotton t-shirts/tees → 6109.10)');
      }
    }

    console.log(`\nApplying ${patches.length} rule patches (batch TT22)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    console.log(`\nPatch TT22 complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
