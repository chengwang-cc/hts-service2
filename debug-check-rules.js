const { Client } = require('pg');
const client = new Client({ host: '192.168.1.209', port: 5432, user: 'postgres', password: 'wbroot0216', database: 'hts' });

const ruleIds = [
  'AI_CH31_ORGANIC_ANIMAL_FERTILIZER', 'AI_CH66_TELESCOPIC_UMBRELLA', 'AI_CH91_POCKET_WATCH',
  'CEMENT_CONCRETE_INTENT', 'AI_CH40_PET_TOY_RUBBER', 'AI_CH59_COATED_FABRIC_PVC_PU',
  'AI_CH58_RIBBON_TRIM', 'AI_CH66_WALKING_STICK', 'AI_CH45_CORK_MISC_ARTICLES',
  'AI_CH03_SMOKED_DRIED_SALTED_FISH', 'AI_CH02_SALTED_CURED_MEAT', 'FRESH_FRUIT_INTENT',
  'AI_CH24_TOBACCO_EXTRACTS', 'AI_CH13_VEGETABLE_EXTRACTS', 'AI_CH89_FERRY_CARGO_VESSEL',
];

async function run() {
  await client.connect();
  const { rows } = await client.query("SELECT rule_id, pattern, whitelist FROM lookup_intent_rule WHERE rule_id = ANY($1)", [ruleIds]);
  for (const r of rows) {
    const pat = r.pattern || {};
    console.log(`\n${r.rule_id}:`);
    console.log(`  allowChapters: ${JSON.stringify((r.whitelist||{}).allowChapters)}`);
    console.log(`  anyOf: ${JSON.stringify(pat.anyOf?.slice(0,8))}${(pat.anyOf||[]).length > 8 ? '...' : ''}`);
    console.log(`  noneOf (first 8): ${JSON.stringify((pat.noneOf||[]).slice(0,8))}`);
  }
  await client.end();
}
run().catch(e => { console.error(e); process.exit(1); });
