#!/usr/bin/env ts-node
/**
 * Patch YYYY — 2026-03-13:
 *
 * Fix remaining EMPTY cases from 5025 entry eval after TTTT-XXXX:
 *
 * 1. ch.95: 7 empties — Christmas/festive articles and billiard accessories
 *    "Santa Figurine", "Christopher Radko Blown Glass Christmas Duck" → 9505 (festive)
 *    "Billiards Pocket Maker" → 9504 (billiard accessories)
 *
 * 2. ch.48: 7 empties — stationery and printed paper products
 *    "Story Bookmark", "A5 savings challenges", "Softcover Paperback Workbook" → 4820
 *    "paper receipt books" → 4820/4821
 *
 * 3. ch.49: 8 empties — printed matter and catalogues
 *    "Milk Paint Colour Card", "Milk Paint Fan Deck" → 4911
 *    "Trading cards (Topps Goosebumps)" → 4901 or 9504
 *
 * 4. ch.85: remaining empties — car speakers, headset adapters
 *    "Pioneer TS-R200 Door Speaker" → 8518 (loudspeakers/audio)
 *    "cm3512 headset buddy adapter" → 8518 (audio accessories)
 *    "heated seat switch" → 8516 (heating equipment for seats)
 *
 * 5. ch.62: bolero/tutu garments missing from OUTERWEAR_JACKET_GARMENT_INTENT
 *    "Organza Bolero", "Adult Harley Quinn Tutu" → ch.62
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-13yyyy.ts
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

    function addToAnyOf(ruleId: string, toAdd: string[], note: string): void {
      const existing = allRules.find(r => r.id === ruleId) as IntentRule | undefined;
      if (!existing) { console.log(`WARNING: ${ruleId} not found`); return; }
      const pat = existing.pattern as any ?? {};
      const currentAnyOf: string[] = pat.anyOf ?? [];
      const newTerms = toAdd.filter(t => !currentAnyOf.includes(t));
      patches.push({
        priority: (existing as any).priority ?? 500,
        rule: {
          ...existing,
          description: (existing.description ?? ruleId) + ` — Fixed YYYY: ${note}`,
          pattern: { ...pat, anyOf: [...currentAnyOf, ...newTerms] },
        },
      });
      console.log(`${ruleId}: adding ${newTerms.length} anyOf terms`);
    }

    // ── 1. NEW CHRISTMAS_FESTIVE_ARTICLE_INTENT ───────────────────────────────
    // "Santa Figurine", "Blown Glass Christmas Duck", "Christmas ornament" → 9505 (ch.95)
    // These festive articles have no positive rule → EMPTY or wrong chapter.
    patches.push({
      priority: 566,
      rule: {
        id: 'CHRISTMAS_FESTIVE_ARTICLE_INTENT',
        description: 'Christmas and festive articles → 9505 (ch.95). ' +
          '"Santa figurine", "blown glass Christmas ornament", "holiday decoration". ' +
          'Without rule, these seasonal items route to wrong chapters or EMPTY.',
        pattern: {
          anyOf: [
            'santa figurine', 'santa claus figurine', 'santa ornament',
            'christmas ornament', 'christmas ornaments', 'holiday ornament',
            'christmas decoration', 'christmas decorations', 'christmas decor',
            'blown glass christmas', 'glass christmas ornament',
            'christmas figurine', 'christmas statue', 'christmas duck',
            'nutcracker', 'snow globe', 'snowglobe',
            'halloween decoration', 'halloween ornament',
            'easter decoration', 'easter ornament',
            'festive article', 'holiday decoration',
          ],
          noneOf: [
            'pattern', 'cross stitch', 'crochet pattern', 'knit pattern',
            'pdf', 'digital',
          ],
        },
        whitelist: { allowChapters: ['95'] },
        inject: [
          { prefix: '9505.10.50', syntheticRank: 9 }, // Christmas articles of other material
          { prefix: '9505.10.25', syntheticRank: 8 }, // Blown glass Christmas ornaments
          { prefix: '9505.10.10', syntheticRank: 7 }, // Christmas trees/articles of plastics
          { prefix: '9505.90.40', syntheticRank: 6 }, // Festive, carnival articles (other)
        ],
        boosts: [
          { delta: 0.4, prefixMatch: '9505' },
        ],
      } as IntentRule,
    });

    // ── 2. NEW STATIONERY_NOTEBOOK_INTENT ─────────────────────────────────────
    // "Story Bookmark", "A5 savings challenges", "Softcover Paperback Workbook" → 4820 (ch.48)
    // "paper receipt books", "carbonless copy" → 4820/4821
    patches.push({
      priority: 561,
      rule: {
        id: 'STATIONERY_NOTEBOOK_INTENT',
        description: 'Paper stationery, notebooks, workbooks → 4820/4821 (ch.48). ' +
          '"Savings challenges", "workbook", "bookmark", "receipt book" → ch.48. ' +
          'Without rule, these paper goods return EMPTY.',
        pattern: {
          anyOf: [
            'bookmark', 'bookmarks', 'story bookmark',
            'savings challenge', 'savings challenges', 'savings tracker', 'budget challenge',
            'workbook', 'workbooks', 'exercise book', 'exercise books',
            'receipt book', 'receipt books', 'invoice book', 'order book',
            'carbonless', 'carbon copy', 'duplicate book',
            'notebook refill', 'planner refill', 'journal refill',
            'scratch pad', 'scratch book', 'memo pad', 'memo book',
            'sticker book', 'activity book',
          ],
          noneOf: [
            'digital', 'pdf', 'pattern', 'printable',
            'ebook', 'e-book',
          ],
        },
        whitelist: { allowChapters: ['48', '49'] },
        inject: [
          { prefix: '4820.10.20', syntheticRank: 9 }, // Registers, account books, receipt books
          { prefix: '4820.10.40', syntheticRank: 8 }, // Notebooks/memo pads
          { prefix: '4821.10.20', syntheticRank: 7 }, // Paper labels
          { prefix: '4820.30.00', syntheticRank: 6 }, // Binders, folders for loose sheets
        ],
        boosts: [
          { delta: 0.4, prefixMatch: '4820' },
          { delta: 0.3, prefixMatch: '4821' },
        ],
      } as IntentRule,
    });

    // ── 3. NEW PRINTED_MATTER_CATALOGUE_INTENT ────────────────────────────────
    // "Milk Paint Colour Card", "Fan Deck" → 4911 (ch.49 other printed matter)
    // "Trading cards (collectible)" → 9504 (games) or 4901 (printed books)
    patches.push({
      priority: 560,
      rule: {
        id: 'PRINTED_MATTER_CATALOGUE_INTENT',
        description: 'Colour cards, fan decks, sample cards → 4911 (ch.49). ' +
          '"Milk Paint Colour Card", "fan deck", "colour chart" → 4911 (commercial catalogues/printed matter). ' +
          'Trading cards (Topps, Pokémon) → 9504.40 (playing cards). ',
        pattern: {
          anyOf: [
            'colour card', 'color card', 'paint colour card', 'paint card',
            'fan deck', 'colour chart', 'color chart', 'paint chip',
            'sample card', 'swatch card', 'colour swatch',
            'topps', 'trading card', 'collectible card', 'collector card',
            'printed map', 'vintage map', 'antique map',
          ],
          noneOf: [
            'credit card', 'debit card', 'gift card',
            'playing card deck', 'tarot',
            'yoga', 'sports card',  // Sports cards are also 4911 but different context
          ],
        },
        whitelist: { allowChapters: ['49', '95'] },
        inject: [
          { prefix: '4911.91.40', syntheticRank: 9 }, // Other printed matter, lithographs
          { prefix: '4911.99.80', syntheticRank: 8 }, // Other printed matter
          { prefix: '9504.40.00', syntheticRank: 7 }, // Playing cards
          { prefix: '4901.99.00', syntheticRank: 6 }, // Books, brochures, printed matter
        ],
        boosts: [
          { delta: 0.35, prefixMatch: '4911' },
          { delta: 0.3, prefixMatch: '4901' },
        ],
      } as IntentRule,
    });

    // ── 4. NEW LOUDSPEAKER_AUDIO_ACCESSORY_INTENT ─────────────────────────────
    // "Pioneer TS-R200 Door Speaker", "headset buddy adapter", "car speaker" → 8518 (ch.85)
    // Car speakers, headphone adapters, audio adapters → 8518 (loudspeakers/audio)
    patches.push({
      priority: 583,
      rule: {
        id: 'LOUDSPEAKER_AUDIO_ACCESSORY_INTENT',
        description: 'Loudspeakers and audio accessories → 8518 (ch.85). ' +
          '"Car speakers", "door speakers", "headset adapter", "audio adapter" → 8518. ' +
          'Without rule, branded/model-specific audio items return EMPTY.',
        pattern: {
          anyOf: [
            // Speakers
            'car speaker', 'car speakers', 'door speaker', 'door speakers',
            'component speaker', 'coaxial speaker', 'speaker cone',
            '6x9 speaker', '6.5 speaker', '5.25 speaker', '5x7 speaker',
            'tweeter', 'woofer', 'subwoofer', 'midrange speaker',
            'speaker pair', 'speaker set',
            // Headphones/headsets
            'headset adapter', 'headset buddy', 'headphone adapter',
            'audio adapter', 'audio splitter', 'headphone splitter',
            '3.5mm adapter', 'trs adapter', 'trrs adapter',
            // General audio
            'amplifier board', 'amp board', 'audio amplifier',
            'sound card', 'usb audio', 'audio interface',
          ],
          noneOf: [
            'waterproof speaker', 'bluetooth speaker', 'portable speaker',  // These are handled elsewhere
            'smart speaker', 'alexa', 'google home',
          ],
        },
        whitelist: { allowChapters: ['85'] },
        inject: [
          { prefix: '8518.29.80', syntheticRank: 9 }, // Other loudspeakers
          { prefix: '8518.21.00', syntheticRank: 8 }, // Single loudspeaker in enclosure
          { prefix: '8518.90.80', syntheticRank: 7 }, // Parts of audio equipment
          { prefix: '8518.10.80', syntheticRank: 6 }, // Microphones
        ],
        boosts: [
          { delta: 0.4, prefixMatch: '8518' },
        ],
      } as IntentRule,
    });

    // ── 5. Expand OUTERWEAR_JACKET_GARMENT_INTENT with bolero/tutu ────────────
    // "Organza Bolero", "Adult Harley Quinn Tutu" → ch.62
    addToAnyOf('OUTERWEAR_JACKET_GARMENT_INTENT', [
      'bolero', 'boleros',
      'tutu', 'tutus', 'tutu skirt',
      'skirt', 'skirts', 'mini skirt', 'maxi skirt', 'pencil skirt',
      'jumpsuit', 'jumpsuits', 'romper', 'rompers',
      'bodysuit', 'bodysuits',
      'leotard', 'leotards',
      'dress', 'dresses',  // Add generic dress
    ], 'added bolero/tutu/skirt/jumpsuit/dress to garment intent → ch.61/62');

    // ── 6. Expand AUTOMOTIVE_ELECTRICAL_SWITCH_INTENT with seat heater ────────
    addToAnyOf('AUTOMOTIVE_ELECTRICAL_SWITCH_INTENT', [
      'heated seat switch', 'seat heater switch', 'seat heating switch',
      'seat warmer switch', 'seat heater control',
      'temperature control switch', 'hvac control switch',
      'blower switch', 'fan speed switch',
      'mirror switch', 'mirror control switch',
    ], 'added heated seat/HVAC switch terms → ch.85');

    console.log(`Applying ${patches.length} rule patches (batch YYYY)...`);
    let success = 0, failed = 0;

    for (const { rule, priority } of patches) {
      try {
        await (svc as any).upsertRule(rule, priority, true);
        console.log(`  ✅ ${(rule as any).id}`);
        success++;
      } catch (err) {
        console.error(`  ❌ ${(rule as any).id}:`, err);
        failed++;
      }
    }

    await svc.reload();
    console.log(`\nPatch YYYY complete: ${success} applied, ${failed} failed`);
    console.log(`Rules in cache: ${svc.ruleCount}`);

    if (failed > 0) process.exitCode = 1;
  } finally {
    await app.close();
  }
}

patch().catch((err) => { console.error('Fatal:', err); process.exit(1); });
