const { Client } = require('pg');
const client = new Client({ host: '192.168.1.209', port: 5432, user: 'postgres', password: 'wbroot0216', database: 'hts' });
async function run() {
  await client.connect();
  // Check AI_CH51 rules for inject/boosts
  const { rows: r1 } = await client.query("SELECT rule_id, pattern, inject, boosts, whitelist FROM lookup_intent_rule WHERE rule_id IN ('AI_CH51_CASHMERE_FIBER', 'AI_CH51_RAW_WOOL')");
  for (const r of r1) { console.log(`${r.rule_id}:`, JSON.stringify({inject:r.inject,boosts:r.boosts,whitelist:r.whitelist,anyOf:r.pattern?.anyOf?.slice(0,5)})); }
  // Check ch.51 HTS entries for cashmere/wool yarn
  const { rows: r2 } = await client.query("SELECT hts_number, description FROM hts WHERE chapter='51' AND description ILIKE '%yarn%' LIMIT 5");
  console.log('ch.51 yarn:', r2.map(r => `${r.hts_number}: ${r.description}`));
  // Check ch.74 copper entries for pins/turban
  const { rows: r3 } = await client.query("SELECT hts_number, description FROM hts WHERE chapter='74' LIMIT 5");
  console.log('ch.74:', r3.map(r => `${r.hts_number}: ${r.description}`));
  // Check ch.92 mouthpiece entries
  const { rows: r4 } = await client.query("SELECT hts_number, description FROM hts WHERE hts_number LIKE '9209%' LIMIT 5");
  console.log('9209:', r4.map(r => `${r.hts_number}: ${r.description}`));
  // Check if 5108 has 10-digit
  const { rows: r5 } = await client.query("SELECT hts_number FROM hts WHERE hts_number LIKE '5108%' AND LENGTH(REPLACE(hts_number,'.',''))=10 LIMIT 3");
  console.log('5108 10-digit:', r5.map(r => r.hts_number));
  // Check 5107 (yarn of combed wool)
  const { rows: r6 } = await client.query("SELECT hts_number FROM hts WHERE hts_number LIKE '5107%' AND LENGTH(REPLACE(hts_number,'.',''))=10 LIMIT 3");
  console.log('5107 10-digit:', r6.map(r => r.hts_number));
  await client.end();
}
run().catch(e => { console.error(e); process.exit(1); });
