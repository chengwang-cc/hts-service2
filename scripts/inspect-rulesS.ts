import 'tsconfig-paths/register';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { IntentRuleService } from '../src/modules/lookup/services/intent-rule.service';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const svc = app.get(IntentRuleService, { strict: false });
  const allRules = svc.getAllRules();

  const ids = [
    'AI_CH75_NICKEL_BAR_ROD_WIRE',  // copper-nickel bars still firing?
    'CARDBOARD_PAPER_INTENT',        // fires for photographic paper
    'AI_CH53_BURLAP_HESSIAN',        // needs allowChapters:[53]
    'AI_CH64_ESPADRILLE',            // fires for jute fabrics
    'AI_CH56_TWINE_BALER',           // fires for jute bast fibers
    'JAM_PRESERVE_INTENT',           // fires for petroleum jelly
    'PRESERVED_FOOD_CH20_INTENT',    // fires for paraffin wax
    'AI_CH92_TUNING_FORK_PITCH_PIPE', // fires for agricultural tool forks
    'AI_CH26_NIOBIUM_TANTALUM_ORE',  // fires for vanadium slag
    'AI_CH81_VANADIUM',              // fires for vanadium slag
    'AI_CH40_RUBBER_CELLULAR_FOAM',  // fires for cellular rubber furniture
    'AI_CH37_PHOTO_FILM_35MM',       // fires for photographic plates
    'AI_CH37_DEVELOPED_FILM_SLIDES', // fires for photographic plates
    'HAIR_ACCESSORY_INTENT',         // fires for hair clippers
    'HAIR_CLIP_ACCESSORY_INTENT',    // fires for hair clippers
    'SCISSORS_INTENT',               // fires for hair clippers
  ];

  for (const id of ids) {
    const r = allRules.find(r => r.id === id);
    if (r) console.log('\n' + id + ':\n' + JSON.stringify({ pattern: r.pattern, whitelist: r.whitelist }, null, 2));
    else console.log('\n' + id + ': NOT FOUND');
  }

  await app.close();
}

main().catch(e => { console.error(e); process.exit(1); });
