const { Client } = require('pg');
const client = new Client({ host: '192.168.1.209', port: 5432, user: 'postgres', password: 'wbroot0216', database: 'hts' });
async function run() {
  await client.connect();
  // Check mousepad entries
  const { rows: mp } = await client.query("SELECT hts_number, chapter, description FROM hts WHERE description ILIKE '%mouse pad%' OR description ILIKE '%mousepad%' LIMIT 5");
  console.log('Mousepad:', mp.map(r => `${r.hts_number} ch=${r.chapter}: ${r.description}`));
  // Check 5911 entries
  const { rows: s5911 } = await client.query("SELECT hts_number, description FROM hts WHERE hts_number LIKE '5911%' LIMIT 5");
  console.log('5911:', s5911.map(r => `${r.hts_number}: ${r.description}`));
  // Check 4201 entries
  const { rows: pet } = await client.query("SELECT hts_number, description FROM hts WHERE hts_number LIKE '4201%' LIMIT 5");
  console.log('4201:', pet.map(r => `${r.hts_number}: ${r.description}`));
  // Check what chapter 87 has for "cargo carrier"
  const { rows: cc } = await client.query("SELECT hts_number, description FROM hts WHERE hts_number LIKE '8716%' LIMIT 5");
  console.log('8716:', cc.map(r => `${r.hts_number}: ${r.description}`));
  // ch.87 has 8716 for trailers/non-motorized vehicles
  const { rows: tp } = await client.query("SELECT hts_number, description FROM hts WHERE chapter='87' AND description ILIKE '%carrier%' LIMIT 5");
  console.log('87 carriers:', tp.map(r => `${r.hts_number}: ${r.description}`));
  await client.end();
}
run().catch(e => { console.error(e); process.exit(1); });
