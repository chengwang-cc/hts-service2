const { Client } = require('pg');
const client = new Client({ host: '192.168.1.209', port: 5432, user: 'postgres', password: 'wbroot0216', database: 'hts' });
async function run() {
  await client.connect();
  const { rows } = await client.query("SELECT rule_id, pattern, whitelist FROM lookup_intent_rule WHERE rule_id IN ('AI_CH02_OFFAL', 'JEWELRY_NECKLACE_INTENT', 'AI_CH40_RUBBER_TIRES', 'AI_CH40_PNEUMATIC_TIRES', 'AI_CH75_NICKEL_SHEET_PLATE_FOIL')");
  for (const r of rows) {
    console.log(`\n${r.rule_id}:`);
    console.log(`  allowChapters: ${JSON.stringify((r.whitelist||{}).allowChapters)}`);
    console.log(`  anyOf: ${JSON.stringify(r.pattern?.anyOf?.slice(0,10))}`);
    console.log(`  noneOf (first 8): ${JSON.stringify((r.pattern?.noneOf||[]).slice(0,8))}`);
  }
  // Check 6301.10 entries (electric heated blankets)
  const { rows: r2 } = await client.query("SELECT hts_number, description FROM hts WHERE hts_number LIKE '6301%' AND LENGTH(REPLACE(hts_number,'.',''))=10 LIMIT 5");
  console.log('\n6301 10-digit:', r2.map(r => `${r.hts_number}: ${r.description}`));
  // Check 4802.10 
  const { rows: r3 } = await client.query("SELECT hts_number, description FROM hts WHERE hts_number LIKE '4802.10%' AND LENGTH(REPLACE(hts_number,'.',''))=10 LIMIT 3");
  console.log('4802.10 10-digit:', r3.map(r => `${r.hts_number}: ${r.description}`));
  // Check 7104.29 - synthetic stones
  const { rows: r4 } = await client.query("SELECT hts_number, description FROM hts WHERE hts_number LIKE '7104%' LIMIT 5");
  console.log('7104:', r4.map(r => `${r.hts_number}: ${r.description}`));
  await client.end();
}
run().catch(e => { console.error(e); process.exit(1); });
