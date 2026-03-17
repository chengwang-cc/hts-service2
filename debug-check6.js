const { Client } = require('pg');
const client = new Client({ host: '192.168.1.209', port: 5432, user: 'postgres', password: 'wbroot0216', database: 'hts' });
async function run() {
  await client.connect();
  // Check 8543.70 and 8543.90 for 10-digit entries
  const { rows: r1 } = await client.query("SELECT hts_number FROM hts WHERE hts_number LIKE '8543.70%' AND LENGTH(REPLACE(hts_number,'.',''))=10 LIMIT 3");
  console.log('8543.70 10-digit:', r1.map(r => r.hts_number));
  // Check AI_CH91_MARINE_CHRONOMETER anyOf
  const { rows: r2 } = await client.query("SELECT pattern FROM lookup_intent_rule WHERE rule_id='AI_CH91_MARINE_CHRONOMETER'");
  console.log('MARINE_CHRONO pattern:', JSON.stringify(r2[0]?.pattern));
  // Check what fires for 'swagger' to confirm AI_CH66_WALKING_STICK
  const { rows: r3 } = await client.query("SELECT hts_number FROM hts WHERE chapter='87' LIMIT 3");
  console.log('ch.87 samples:', r3.map(r => r.hts_number));
  // Check for cargo carrier HTS entries
  const { rows: r4 } = await client.query("SELECT hts_number, description FROM hts WHERE chapter='87' AND description ILIKE '%cargo%' LIMIT 3");
  console.log('ch.87 cargo:', r4.map(r => `${r.hts_number}: ${r.description}`));
  // Check 8716 full desc
  const { rows: r5 } = await client.query("SELECT hts_number, description FROM hts WHERE hts_number LIKE '8716.39%' LIMIT 3");
  console.log('8716.39:', r5.map(r => `${r.hts_number}: ${r.description}`));
  // Check 4201.00 for 10-digit  
  const { rows: r6 } = await client.query("SELECT hts_number FROM hts WHERE hts_number LIKE '4201%' AND LENGTH(REPLACE(hts_number,'.',''))=10 LIMIT 5");
  console.log('4201 10-digit:', r6.map(r => r.hts_number));
  await client.end();
}
run().catch(e => { console.error(e); process.exit(1); });
