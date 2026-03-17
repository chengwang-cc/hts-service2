const { Client } = require('pg');
const client = new Client({ host: '192.168.1.209', port: 5432, user: 'postgres', password: 'wbroot0216', database: 'hts' });
async function run() {
  await client.connect();
  const { rows } = await client.query("SELECT rule_id, pattern, inject, boosts, whitelist FROM lookup_intent_rule WHERE rule_id IN ('PET_ACCESSORY_INTENT', 'PET_TOY_SUPPLY_INTENT', 'LEATHER_HIDES_INTENT')");
  for (const r of rows) {
    console.log(`\n${r.rule_id}:`);
    console.log(`  anyOf: ${JSON.stringify(r.pattern?.anyOf?.slice(0,6))}`);
    console.log(`  inject: ${JSON.stringify(r.inject?.slice(0,3))}`);
  }
  // Check HANDMADE_WASHI_PAPER_INTENT anyOf 
  const { rows: r2 } = await client.query("SELECT pattern FROM lookup_intent_rule WHERE rule_id='HANDMADE_WASHI_PAPER_INTENT'");
  console.log('\nHANDMADE_WASHI:', JSON.stringify(r2[0]?.pattern?.anyOf));
  await client.end();
}
run().catch(e => { console.error(e); process.exit(1); });
