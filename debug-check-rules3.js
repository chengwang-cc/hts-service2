const { Client } = require('pg');
const client = new Client({ host: '192.168.1.209', port: 5432, user: 'postgres', password: 'wbroot0216', database: 'hts' });
async function run() {
  await client.connect();
  // Check chapter format for coffee
  const { rows: coffee } = await client.query("SELECT hts_number, chapter, description FROM hts WHERE hts_number LIKE '0901%' LIMIT 3");
  console.log('Coffee entries:', coffee.map(r => `${r.hts_number} ch=${r.chapter}`));
  // Check portrait/photo entries
  const { rows: photo } = await client.query("SELECT hts_number, chapter, description FROM hts WHERE hts_number LIKE '3705%' LIMIT 3");
  console.log('Photo 3705:', photo.map(r => `${r.hts_number}: ${r.description}`));
  // Check if 0901 has 10-digit entries
  const { rows: c09 } = await client.query("SELECT hts_number FROM hts WHERE hts_number LIKE '0901.21%' LIMIT 3");
  console.log('0901.21 entries:', c09.map(r => r.hts_number));
  // Check encoder entries
  const { rows: enc } = await client.query("SELECT hts_number, description FROM hts WHERE description ILIKE '%encoder%' LIMIT 5");
  console.log('Encoder entries:', enc.map(r => `${r.hts_number}: ${r.description}`));
  await client.end();
}
run().catch(e => { console.error(e); process.exit(1); });
