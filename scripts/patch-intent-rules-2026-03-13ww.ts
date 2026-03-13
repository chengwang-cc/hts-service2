#!/usr/bin/env ts-node
/**
 * Patch WW — 2026-03-13:
 *
 * Fix 20 cross-chapter routing failures found from comprehensive eval analysis.
 * Starting accuracy: 84.86% (594/700), 0 empty results.
 *
 * Fixes:
 * 1.  FRESH_VEGETABLE_INTENT: "Yellow dent corn" → ch.10 grain, not ch.07 vegetable
 *     Add noneOf: 'dent','for sowing','seed','seeds'
 *
 * 2.  AI_CH15_CANOLA_RAPESEED_OIL + AI_CH15_RAPESEED_OIL: "For sowing...rape seeds" →
 *     ch.12 seeds, not ch.15 oils. Add noneOf: 'for sowing','sowing','planting'
 *
 * 3.  NEW SEED_FOR_SOWING_INTENT: phrases like "for sowing" → allowChapters:[12]
 *
 * 4.  AI_CH64_HIGH_HEELS: "Concrete pumps/Pumps for liquids" → ch.84, not ch.64
 *     Add noneOf: 'concrete','liquids','measuring device','liquid elevator'
 *
 * 5.  CEMENT_CONCRETE_INTENT: same pump query → add noneOf: 'pump','pumps'
 *
 * 6.  AI_CH09_CLOVES: "Of clove Other" → ch.33 essential oil, not ch.09 spice
 *     Add noneOf: 'essential', phrase 'of clove'
 *
 * 7.  NAIL_RIVET_INTENT: "Rivets Nails...aluminum articles" → also allowChapters ch.76
 *     (aluminum nails/rivets, 7616.10). Add ch.76 alongside ch.73.
 *
 * 8.  AI_CH47_RECOVERED_PAPER: "Tantalum...waste and scrap" → ch.81, not ch.47
 *     Add noneOf: 'tantalum','niobium','hafnium','rhenium' (ch.81 rare metals)
 *
 * 9.  AI_CH03_LIVE_FISH: "Foxes/bovine live animals" → ch.01, not ch.03
 *     Add noneOf for terrestrial mammals: foxes, bovine, equine, etc.
 *
 * 10. MEAT_BEEF_INTENT: "Purebred breeding bovine animals" → ch.01, not ch.02
 *     Add noneOf: 'purebred','breeding'
 *
 * 11. AI_CH35_CASEIN: "Button blanks of casein" → ch.96, not ch.35
 *     Add noneOf: 'button','buttons','blank','blanks'
 *
 * 12. SEAFOOD_FISH_INTENT: "Based on fish...Soups and broths" → ch.21, not ch.03
 *     Add noneOf: 'soup','soups','broth','broths','based on'
 *
 * 13. PLYWOOD_LUMBER_INTENT: "...timber wedges...tools of agriculture" → ch.82, not ch.44
 *     Add noneOf phrase: 'timber wedge','timber wedges' + 'mattock','hoe','hoes','spade','spades'
 *
 * 14. SKI_SNOWBOARD_INTENT: "Cross-country ski gloves" → ch.42, not ch.95
 *     Add noneOf: 'gloves','glove','mittens','mitts'
 *
 * 15. AI_CH22_SPIRITS_RUM: "Cane or beet sugar...sucrose" → ch.17, not ch.22
 *     Add noneOf: 'beet','sucrose'
 *
 * 16. CRAFT_KIT_INTENT: "Hand-woven...loom width" → ch.51 wool fabric, not ch.95 craft
 *     Add noneOf phrase: 'loom width'
 *
 * 17. PREPARED_CANNED_MEATS_INTENT: "Fertilized fish eggs" → ch.05, not ch.16
 *     Add noneOf: 'fertilized'
 *
 * 18. NEW FERTILIZED_EGG_INTENT: 'fertilized'+'eggs/roe' → allowChapters:[05]
 *
 * 19. AI_CH75_NICKEL_BAR_ROD_WIRE: "Copper-nickel bars" → ch.74, not ch.75
 *     Add noneOf: 'cupro', phrase 'copper-nickel'
 *
 * 20. NEW COPPER_TUBE_PIPE_INTENT: copper/brass/bronze + tube/pipe → allowChapters:[74]
 *     Fixes "Seamless copper-zinc brass Copper tubes" routed to ch.93
 *
 * 21. AI_CH03_SMOKED_DRIED_SALTED_FISH: "Shelled nuts fresh or dried" → ch.08, not ch.03
 *     Add noneOf: 'nuts','nut','kernel','kernels'
 *
 * 22. NEW AUDIO_CARTRIDGE_INTENT: pickup cartridges → ch.85, not ch.93
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-13ww.ts
 */
import 'tsconfig-paths/register';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { IntentRuleService } from '../src/modules/lookup/services/intent-rule.service';
import type { IntentRule } from '../src/modules/lookup/services/intent-rules';

const SPICE_NONE_OF = [
  'allspice','pimenta','genus','spice','spices','herb','herbs','botanical',
  'cinnamon','pepper','clove','cloves','cardamom','ginger','nutmeg','mace',
  'saffron','turmeric','vanilla','bay','curry','cumin','coriander',
  'neither crushed nor ground','crushed nor ground',
];

const PATCHES: Array<{ rule: IntentRule; priority: number }> = [

  // ── 1. FRESH_VEGETABLE_INTENT — exclude grain corn / seed contexts ──────────
  {
    priority: 630,
    rule: {
      id: 'FRESH_VEGETABLE_INTENT',
      description: 'Fresh vegetables → ch.07. ' +
        'WW: Added noneOf for grain corn ("dent" = yellow dent corn = field corn not vegetable), ' +
        '"for sowing"/"seed"/"seeds" = seeds context (ch.12), not vegetable (ch.07).',
      pattern: {
        anyOf: [
          'broccoli','carrot','carrots','potato','potatoes','onion','onions',
          'tomato','tomatoes','spinach','lettuce','mushroom','mushrooms',
          'cucumber','cucumbers','corn','garlic','asparagus','zucchini',
          'eggplant','celery','cabbage','cauliflower','pumpkin','squash',
          'vegetable','vegetables','produce',
        ],
        noneOf: [
          'machinery','machine','machines','sorting','grading','harvesting',
          'threshing','cleaning','processing','incubator','agricultural machinery',
          'fibers','fiber','material','materials','upper','uppers','sole','soles',
          'textile','textiles','yarn','thread','woven','knitted',
          'preserved by sugar','preserved','glazed','crystallized',
          'gluten','gluten meal','corn gluten',
          'fats','oils','fat','oil','fatty acids','fatty acid','lipids',
          'microbial fats','fractions','inedible',
          // WW: grain corn and seed contexts
          'dent',         // yellow dent corn = field grain corn → ch.10
          'for sowing',   // seeds for sowing → ch.12
          'seed',         // seed context → ch.12
          'seeds',        // seeds context → ch.12
        ],
      },
      whitelist: { allowChapters: ['07'] },
    },
  },

  // ── 2. AI_CH15_CANOLA_RAPESEED_OIL — exclude sowing seed context ───────────
  {
    priority: 640,
    rule: {
      id: 'AI_CH15_CANOLA_RAPESEED_OIL',
      description: 'Canola/rapeseed/colza oil → ch.15. ' +
        'WW: Added noneOf for sowing seed context: "for sowing" = seeds chapter (ch.12), ' +
        'not vegetable oil (ch.15). Rape/colza seeds for sowing → 1205.',
      pattern: {
        anyOf: ['canola','rapeseed','colza','mustard oil','mustard seed oil'],
        noneOf: [
          'cooking','spray','motor',
          // WW: seed-for-sowing context → ch.12
          'for sowing','sowing','planting',
        ],
      },
      whitelist: { allowChapters: ['15'] },
    },
  },

  // ── 3. AI_CH15_RAPESEED_OIL — exclude sowing seed context ──────────────────
  {
    priority: 640,
    rule: {
      id: 'AI_CH15_RAPESEED_OIL',
      description: 'Rapeseed/colza oil → ch.15. ' +
        'WW: Added noneOf for sowing seed context.',
      pattern: {
        anyOf: ['rapeseed','colza','rape oil'],
        noneOf: [
          'cooking','spray','motor',
          // WW: seed-for-sowing context → ch.12
          'for sowing','sowing','planting',
        ],
      },
      whitelist: { allowChapters: ['15'] },
    },
  },

  // ── 4. NEW SEED_FOR_SOWING_INTENT — "for sowing" → ch.12 seeds ─────────────
  {
    priority: 650,
    rule: {
      id: 'SEED_FOR_SOWING_INTENT',
      description: 'Seeds for sowing → ch.12 (oil seeds, misc seeds). ' +
        '"For sowing" / "seeds for sowing" is an HTS-specific phrase in heading 1205-1209 ' +
        'that unambiguously means seeds chapter (ch.12), not oil chapter (ch.15).',
      pattern: {
        anyOf: [
          'for sowing','seeds for sowing','seed for sowing','for planting',
          'sowing purposes','planted',
        ],
        noneOf: [
          'machinery','machine','machines','agricultural machinery',
          'tractor','planter','seeder','drill',
        ],
      },
      whitelist: { allowChapters: ['12'] },
    },
  },

  // ── 5. AI_CH64_HIGH_HEELS — exclude pump machinery context ─────────────────
  {
    priority: 640,
    rule: {
      id: 'AI_CH64_HIGH_HEELS',
      description: 'High heels, stilettos, court shoes, pumps (footwear) → ch.64. ' +
        'WW: Added noneOf for pump machinery context: "Concrete pumps / Pumps for liquids" ' +
        '(8413 ch.84 machinery) triggered by "pumps" but these are industrial pumps, ' +
        'not shoe pumps. "concrete","liquid","measuring device" are clear machinery signals.',
      pattern: {
        anyOf: [
          'high heels','stiletto heels','pumps','court shoes','kitten heels',
          'cone heels','pointed toe heels','women heels','ladies heels','heel shoes',
        ],
        noneOf: [
          // Pump machinery context → ch.84
          'concrete','liquid','liquids','measuring device','liquid elevator',
          'centrifugal','hydraulic','piston pump','gear pump','diaphragm pump',
          'for liquids','elevators',
        ],
      },
      whitelist: { allowChapters: ['64'] },
    },
  },

  // ── 6. CEMENT_CONCRETE_INTENT — exclude pump machinery context ─────────────
  {
    priority: 640,
    rule: {
      id: 'CEMENT_CONCRETE_INTENT',
      description: 'Cement, concrete, mortar → ch.25. ' +
        'WW: Added noneOf for concrete pump machinery (8413 ch.84): "Concrete pumps / ' +
        'Pumps for liquids" has "concrete" → fires allowChapters:[25] blocking ch.84. ' +
        'A concrete pump is ch.84 machinery, not ch.25 mineral cement.',
      pattern: {
        anyOf: [
          'cement','concrete','mortar','portland cement','ready mix cement',
          'concrete block','cinder block','cement board',
        ],
        noneOf: [
          'mixer','mixers','vehicle','vehicles','motor vehicle','motor vehicles',
          'crane','cranes','truck','trucks','sweeper','sweepers',
          'fire fighting','wrecker','wreckers','radiological',
          'deposit','deposition','additive','layer','printing',
          'ceramics','ceramic','glass deposit',
          // WW: concrete pump machinery → ch.84
          'pump','pumps',
        ],
      },
      whitelist: { allowChapters: ['25'] },
    },
  },

  // ── 7. AI_CH09_CLOVES — exclude essential oil context ──────────────────────
  {
    priority: 640,
    rule: {
      id: 'AI_CH09_CLOVES',
      description: 'Cloves (spice) → ch.09. ' +
        'WW: Added noneOf for essential oil context: HTS 3301.29.51 "Essential oils... ' +
        'Of clove...Other" has "Of clove" as its description → fires allowChapters:[09]. ' +
        '"Of clove" in essential oil sub-descriptions = "oil of clove" (ch.33), ' +
        'not spice cloves (ch.09). Also block "essential" to catch other essential oil contexts.',
      pattern: {
        anyOf: ['clove','cloves'],
        noneOf: [
          'essential',   // essential oil context
          'of clove',    // phrase: HTS 3301 sub-description "Of clove Other"
        ],
      },
      whitelist: { allowChapters: ['09'] },
    },
  },

  // ── 8. NAIL_RIVET_INTENT — add ch.76 for aluminum rivets/nails ─────────────
  {
    priority: 640,
    rule: {
      id: 'NAIL_RIVET_INTENT',
      description: 'Nails, rivets → ch.73 (iron/steel) OR ch.76 (aluminum). ' +
        'WW: Added ch.76 to allowChapters because 7616.10 aluminum rivets/nails/tacks ' +
        'have full HTS descriptions with "rivets nails tacks staples...washers" → ' +
        'rule fires but ch.76 was not in allowSet → result was ch.73 iron (wrong). ' +
        'Adding ch.76 lets semantic choose between iron (ch.73) and aluminum (ch.76) rivets.',
      pattern: {
        anyOf: [
          'nails','nail','framing nail','finish nail','brad nail','roofing nail',
          'rivets','rivet','blind rivet','pop rivet','aluminum rivet',
        ],
      },
      whitelist: { allowChapters: ['73','76'] },
    },
  },

  // ── 9. AI_CH47_RECOVERED_PAPER — exclude rare metal scrap ──────────────────
  {
    priority: 640,
    rule: {
      id: 'AI_CH47_RECOVERED_PAPER',
      description: 'Recovered/recycled paper waste → ch.47. ' +
        'WW: Added noneOf for ch.81 rare metals scrap context: "Tantalum and articles ' +
        'thereof including waste and scrap" (8103.99 ch.81) has "waste" and "scrap" → ' +
        'fires allowChapters:[47]. Tantalum/niobium/hafnium/rhenium scrap → ch.81, ' +
        'not ch.47 (paper waste).',
      pattern: {
        anyOf: ['recovered','recycled','scrap','wastepaper','newsprint','deinking','corrugated','paperboard'],
        noneOf: [
          'machinery','machines','equipment','apparatus','calender','pressing','winding','drying machine',
          // WW: rare/specialty metal scrap → ch.81
          'tantalum','niobium','hafnium','rhenium','gallium','indium','germanium',
          'thallium','vanadium','bismuth','antimony','cobalt',
        ],
      },
      whitelist: { allowChapters: ['47'] },
    },
  },

  // ── 10. AI_CH03_LIVE_FISH — exclude terrestrial mammals ────────────────────
  {
    priority: 640,
    rule: {
      id: 'AI_CH03_LIVE_FISH',
      description: 'Live fish, ornamental fish → ch.03. ' +
        'WW: Added noneOf for terrestrial mammals: "Foxes Other Other live animals" ' +
        '(0106.19 ch.01) and "Live bovine animals" (0102 ch.01) have "live" → fires ' +
        'allowChapters:[03]. Live foxes, bovine, equine etc. are ch.01 (live animals), ' +
        'not ch.03 (aquatic animals).',
      pattern: {
        anyOf: [
          'koi','goldfish','guppy','angelfish','cichlid','betta','carp','eel',
          'ornamental','aquarium','live','fingerling','fry','baitfish',
        ],
        noneOf: [
          // WW: terrestrial/land mammals → ch.01
          'foxes','fox','bovine','bovines','cattle','equine','equines',
          'swine','porcine','ovine','ovines','caprine','caprines',
          'horses','horse','donkey','donkeys','mule','mules',
          'sheep','goat','goats','deer','reindeer','camel','camels',
          'llama','llamas','alpaca','alpacas','bison','buffalo',
          'rabbit','rabbits','hare','hares','pigeon','pigeons',
          'poultry','chicken','chickens','turkey','turkeys',
          'lion','lions','tiger','tigers','bear','bears',
          'elephant','elephants','gorilla','giraffe',
        ],
      },
      whitelist: { allowChapters: ['03'] },
    },
  },

  // ── 11. MEAT_BEEF_INTENT — exclude live breeding animals ───────────────────
  {
    priority: 640,
    rule: {
      id: 'MEAT_BEEF_INTENT',
      description: 'Beef, steak, bovine meat → ch.02. ' +
        'WW: Added noneOf for live breeding animals: "Male Purebred breeding animals ' +
        'Live bovine animals" (0102.21 ch.01) has "bovine" → fires allowChapters:[02] ' +
        '(meat). But "purebred breeding animals" = live, not slaughtered for meat → ch.01.',
      pattern: {
        anyOf: ['beef','steak','brisket','sirloin','bovine','ground beef'],
        noneOf: [
          'airtight','airtight containers','canned','preserved','prepared meals',
          'in oil','smoked','leather','tanning','tanned','parchment','crusting','hide','hides',
          // WW: live breeding animals → ch.01
          'purebred','breeding','live animals','live bovine','breeding animals',
        ],
      },
      whitelist: { allowChapters: ['02'] },
    },
  },

  // ── 12. AI_CH35_CASEIN — exclude button/blank manufacturing context ─────────
  {
    priority: 640,
    rule: {
      id: 'AI_CH35_CASEIN',
      description: 'Casein, caseinates → ch.35 (albuminoidal substances). ' +
        'WW: Added noneOf for button manufacturing: "Button blanks of casein" ' +
        '(9606.30 ch.96) uses casein as a material but the product is buttons (ch.96), ' +
        'not industrial casein glue/adhesive (ch.35). "button blanks" = unfinished buttons.',
      pattern: {
        anyOf: ['casein','caseinate','caseinates','milk','protein'],
        noneOf: [
          // WW: button manufacturing context → ch.96
          'button','buttons','blank','blanks',
        ],
      },
      whitelist: {
        allowChapters: ['35'],
        denyChapters: ['04','21','23'],
      },
    },
  },

  // ── 13. SEAFOOD_FISH_INTENT — exclude soup/broth food prep context ──────────
  {
    priority: 640,
    rule: {
      id: 'SEAFOOD_FISH_INTENT',
      description: 'Fresh/chilled seafood and fish → ch.03. ' +
        'WW: Added noneOf for soup/broth food preparation context: "Based on fish or ' +
        'other seafood Soups and broths and preparations therefor" (2104.10 ch.21) has ' +
        '"fish" and "seafood" → fires allowChapters:[03]. Fish soup = food preparation ' +
        '(ch.21), not raw fish (ch.03). Also blocks "based on" as a discriminating phrase.',
      pattern: {
        anyOf: [
          'salmon','tuna','shrimp','prawn','lobster','crab','seafood','fish','fillet',
          'tilapia','cod','halibut','catfish','trout','scallop','oyster','clam',
          'mussel','squid','octopus',
        ],
        noneOf: [
          'prepared meals','airtight containers','in oil','preserved fish','cooked',
          'guts','bladders','bladder','stomachs','stomach','entrails','offal','tripe',
          'intestines','intestine','fertilized',
          // WW: soup/broth/food preparation context → ch.21
          'soup','soups','broth','broths','based on','preparations therefor',
          'extract','extracts',
        ],
      },
      whitelist: { allowChapters: ['03'] },
    },
  },

  // ── 14. PLYWOOD_LUMBER_INTENT — exclude agricultural hand tool context ───────
  {
    priority: 640,
    rule: {
      id: 'PLYWOOD_LUMBER_INTENT',
      description: 'Plywood, lumber, wood boards → ch.44. ' +
        'WW: Added noneOf for agricultural hand tool context: "Mattocks picks hoes ' +
        '...timber wedges and other tools of a kind used in agriculture" (8201.30 ch.82) ' +
        'has "timber" → fires allowChapters:[44]. "Timber wedges" used as agricultural ' +
        'tools are ch.82 (hand tools), not ch.44 (wood). Adding key tool discriminators.',
      pattern: {
        anyOf: [
          'plywood','plywood sheet','lumber','wood board','timber','wooden pallet',
          'wood pallet','pine board','hardwood board','engineered wood','mdf',
          'particle board','wood plank',
        ],
        noneOf: [
          // WW: agricultural hand tools using "timber" → ch.82
          'timber wedge','timber wedges','wedge','wedges',
          'mattock','mattocks','hoe','hoes','spade','spades','pickaxe','pickaxes',
          'sickle','sickles','scythe','scythes','bill hook','hedge shear',
          'secateur','secateurs','pruner','pruners',
          'handtools','hand tools','tools of a kind used in agriculture',
        ],
      },
      whitelist: { allowChapters: ['44'] },
    },
  },

  // ── 15. SKI_SNOWBOARD_INTENT — exclude ski apparel/gloves ──────────────────
  {
    priority: 640,
    rule: {
      id: 'SKI_SNOWBOARD_INTENT',
      description: 'Ski, snowboard equipment → ch.95 (sports equipment). ' +
        'WW: Added noneOf for ski gloves/mittens: "Cross-country ski gloves mittens and ' +
        'mitts Specially designed for use in sports" (4203.21 ch.42) has "ski" → fires ' +
        'allowChapters:[95]. Ski gloves/mittens are leather accessories (ch.42), ' +
        'not sports equipment (ch.95).',
      pattern: {
        anyOf: [
          'ski','skis','alpine ski','downhill ski','cross-country ski','snowboard','freestyle snowboard',
        ],
        noneOf: [
          'pants','jacket','jackets','garments','garment','outerwear','suit','suits',
          'bib','overalls','breeches','clothing','trousers','shorts',
          // WW: ski gloves/mittens → ch.42 (leather accessories)
          'gloves','glove','mittens','mitts','gauntlets',
        ],
      },
      whitelist: { allowChapters: ['95'] },
    },
  },

  // ── 16. AI_CH22_SPIRITS_RUM — exclude sugar/sucrose context ────────────────
  {
    priority: 640,
    rule: {
      id: 'AI_CH22_SPIRITS_RUM',
      description: 'Rum, rhum, sugarcane spirits → ch.22. ' +
        'WW: Added noneOf for cane sugar context: "Other Containing added flavoring or ' +
        'coloring matter Cane or beet sugar...sucrose in solid form" (1701.91 ch.17) has ' +
        '"cane" → fires allowChapters:[22]. "Beet" (sugar beet) and "sucrose" clearly ' +
        'indicate sugar (ch.17), not spirits (ch.22).',
      pattern: {
        anyOf: ['rum','rhum','cachaca','cachaça','aguardiente','cane'],
        noneOf: [
          'raisin','cake',
          // WW: cane/beet sugar context → ch.17
          'beet','sucrose',
        ],
      },
      whitelist: { allowChapters: ['22'] },
    },
  },

  // ── 17. CRAFT_KIT_INTENT — exclude woven fabric / loom width context ────────
  {
    priority: 640,
    rule: {
      id: 'CRAFT_KIT_INTENT',
      description: 'Craft kits (macrame, cross-stitch, loom weaving kits) → ch.95/63. ' +
        'WW: Added noneOf for actual woven fabric context: "Hand-woven with a loom width ' +
        'of less than 76 cm" (5111.11 ch.51) has "loom" → fires allowChapters:[95,63]. ' +
        '"Loom width" is a standard textile specification for woven goods, not a craft kit.',
      pattern: {
        anyOf: [
          'cross stitch kit','counted cross stitch','macrame kit','macrame starter kit',
          'candle making kit','soap making kit','jewelry making kit',
          'loom','weaving loom','peg loom',
        ],
        noneOf: [
          // WW: actual woven fabric with loom width specification → ch.5x
          'loom width','loom widths','woven fabric','woven fabrics','width of',
        ],
      },
      whitelist: { allowChapters: ['95','63'] },
    },
  },

  // ── 18. PREPARED_CANNED_MEATS_INTENT — exclude fertilized eggs ─────────────
  {
    priority: 640,
    rule: {
      id: 'PREPARED_CANNED_MEATS_INTENT',
      description: 'Prepared/canned meat and fish → ch.16. ' +
        'WW: Added noneOf for fertilized eggs: "Fertilized fish eggs" (0511.91 ch.05) ' +
        'has "fish eggs" in anyOf → fires allowChapters:[16]. Fertilized fish eggs are ' +
        'animal products NES (ch.05.11), not prepared fish (ch.16).',
      pattern: {
        anyOf: [
          'airtight containers','airtight container','sausage','sausages',
          'frankfurter','frankfurters','bologna','salami','mortadella','chorizo',
          'prepared meats','prepared meat','canned beef','canned meat','canned pork',
          'meat preparations','meat preparation','homogenized','pate','pâté',
          'prepared or preserved fish','preserved fish',
          'neither cooked nor in oil','in airtight containers',
          'caviar','caviar substitutes','fish eggs',
          'prepared or preserved crustaceans','prepared crustaceans',
          'prepared or preserved molluscs',
        ],
        noneOf: [
          'live','carcass','carcasses','offal','fresh','chilled','not containing',
          // WW: fertilized fish/animal eggs → ch.05
          'fertilized',
        ],
      },
      whitelist: { allowChapters: ['16'] },
    },
  },

  // ── 19. NEW FERTILIZED_EGG_INTENT — fertilized eggs/roe → ch.05 ───────────
  {
    priority: 650,
    rule: {
      id: 'FERTILIZED_EGG_INTENT',
      description: 'Fertilized eggs and roe for incubation → ch.05 (animal products NES). ' +
        'HTS 0511.91.00.10 covers fertilized fish eggs and other fertilized roe for hatching. ' +
        '"Fertilized" + "eggs"/"roe"/"spawn" unambiguously = animal product for hatching, ' +
        'not food egg (ch.04) or prepared fish (ch.16).',
      pattern: {
        anyOfGroups: [
          ['fertilized'],
          ['eggs','egg','roe','spawn','spat'],
        ],
        noneOf: ['poultry','hen','chicken','duck','goose'],
      },
      whitelist: { allowChapters: ['05'] },
    },
  },

  // ── 20. AI_CH75_NICKEL_BAR_ROD_WIRE — exclude cupro-nickel (copper) alloys ──
  {
    priority: 640,
    rule: {
      id: 'AI_CH75_NICKEL_BAR_ROD_WIRE',
      description: 'Nickel bars, rods, wire → ch.75. ' +
        'WW: Added noneOf for cupro-nickel (copper-nickel alloys → ch.74): ' +
        '"Bars and rods of copper-nickel base alloys cupro-nickel" (7407 ch.74) has ' +
        '"nickel" + "bars"+"rods" → fires allowChapters:[75]. Cupro-nickel alloys where ' +
        'copper predominates classify in ch.74 (copper chapter). ' +
        '"cupro" is the canonical prefix for copper-nickel alloys.',
      pattern: {
        anyOf: ['bar','bars','rod','rods','wire','profile','profiles','round','hex','hexagonal','stock'],
        noneOf: [
          'percent','percentage','by weight','weight of','weight of nickel',
          'containing','alloy','stainless','steel','iron',
          // WW: cupro-nickel (copper-dominant nickel alloys) → ch.74
          'cupro','copper-nickel',
        ],
        required: ['nickel'],
      },
      whitelist: { allowChapters: ['75'] },
    },
  },

  // ── 21. NEW COPPER_TUBE_PIPE_INTENT ── copper/brass/bronze tubes → ch.74 ───
  {
    priority: 650,
    rule: {
      id: 'COPPER_TUBE_PIPE_INTENT',
      description: 'Copper, brass, or bronze tubes and pipes → ch.74. ' +
        '"Seamless Of copper-zinc base alloys brass Copper tubes and pipes" (7411 ch.74) ' +
        'was routed to ch.93 (ammunition) due to "brass" semantic association with cartridges. ' +
        'Any query with copper-family metal AND tube/pipe form is ch.74 copper articles.',
      pattern: {
        anyOfGroups: [
          ['copper','brass','bronze','cupro','gunmetal','cupronickel'],
          ['tube','tubes','pipe','pipes','tubing','piping'],
        ],
        noneOf: [
          // Organ pipes / musical instruments → ch.92
          'organ','flute','clarinet',
          // Vacuum tube / electron tube → ch.85
          'electron','vacuum tube','cathode',
        ],
      },
      whitelist: { allowChapters: ['74'] },
    },
  },

  // ── 22. AI_CH03_SMOKED_DRIED_SALTED_FISH — exclude nut context ─────────────
  {
    priority: 640,
    rule: {
      id: 'AI_CH03_SMOKED_DRIED_SALTED_FISH',
      description: 'Smoked, dried, salted fish → ch.03. ' +
        'WW: Added noneOf for shelled nuts context: "Other Shelled Other nuts fresh or ' +
        'dried whether or not shelled or peeled" (0802 ch.08) has "dried" and "shelled" → ' +
        'fires allowChapters:[03]. Dried nuts are ch.08 (fruits and nuts), not fish.',
      pattern: {
        anyOf: [
          'smoked','dried','salted','cured','kippered','bacalao','stockfish',
          'salt','brine','jerky','lox','gravlax','anchovies','anchovy',
          'herring','sardine','mackerel',
        ],
        noneOf: [
          'hides','hide','skins','skin','leather','tanned','tanning','parchment',
          'limed','pickled','dehaired','pretanned','crusting',
          'guts','bladders','bladder','stomachs','stomach','entrails','offal',
          'tripe','intestines','intestine',
          ...SPICE_NONE_OF,
          // WW: nut/seed context → ch.08
          'nuts','nut','kernel','kernels',
        ],
      },
      whitelist: { allowChapters: ['03'] },
    },
  },

  // ── 23. NEW AUDIO_CARTRIDGE_INTENT — pickup cartridges → ch.85 ────────────
  {
    priority: 650,
    rule: {
      id: 'AUDIO_CARTRIDGE_INTENT',
      description: 'Pickup/phono/turntable cartridges → ch.85 (audio parts). ' +
        '"Pickup cartridges" (8522.10 ch.85) is the HTS description for phonograph pickup ' +
        'cartridges (turntable needle cartridges). Without this rule, the query falls back ' +
        'to semantic which confuses "cartridge" with ammunition cartridges (ch.93).',
      pattern: {
        anyOf: [
          'pickup cartridge','pickup cartridges',
          'phono cartridge','phono cartridges',
          'phonograph cartridge','phonograph cartridges',
          'turntable cartridge','turntable cartridges',
          'stylus cartridge','needle cartridge',
        ],
      },
      whitelist: { allowChapters: ['85'] },
    },
  },

];

async function patch(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['warn','error'] });

  try {
    const svc = app.get(IntentRuleService, { strict: false });

    console.log(`Applying ${PATCHES.length} rule patches (batch WW)...`);

    let success = 0;
    let failed = 0;

    for (const { rule, priority } of PATCHES) {
      try {
        await svc.upsertRule(rule, priority, true);
        console.log(`  ✅ ${rule.id}`);
        success++;
      } catch (err) {
        console.error(`  ❌ ${rule.id}:`, err);
        failed++;
      }
    }

    await svc.reload();
    console.log(`\nPatch WW complete: ${success} applied, ${failed} failed`);
    console.log(`Rules in cache: ${svc.ruleCount}`);

    if (failed > 0) {
      process.exitCode = 1;
    }
  } finally {
    await app.close();
  }
}

patch().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
