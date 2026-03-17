const { Client } = require('pg');
const client = new Client({ host: '192.168.1.209', port: 5432, user: 'postgres', password: 'wbroot0216', database: 'hts' });
async function run() {
  await client.connect();
  const { rows } = await client.query("SELECT hts_number, description FROM hts WHERE hts_number LIKE '5911.9%' LIMIT 8");
  console.log('5911.9:', rows.map(r => `${r.hts_number}: ${r.description}`));
  const { rows: r2 } = await client.query("SELECT hts_number, description FROM hts WHERE hts_number LIKE '5911.3%' LIMIT 8");
  console.log('5911.3:', r2.map(r => `${r.hts_number}: ${r.description}`));
  // Check ch.87 for cargo carrier
  const { rows: r3 } = await client.query("SELECT hts_number, description FROM hts WHERE hts_number LIKE '8716%' AND description ILIKE '%cargo%' LIMIT 3");
  console.log('8716 cargo:', r3.map(r => `${r.hts_number}: ${r.description}`));
  // Check ch.44 for shelves
  const { rows: r4 } = await client.query("SELECT hts_number, description FROM hts WHERE chapter='44' AND description ILIKE '%shelf%' LIMIT 3");
  console.log('ch.44 shelf:', r4.map(r => `${r.hts_number}: ${r.description}`));
  // Check 3705
  const { rows: r5 } = await client.query("SELECT hts_number, description FROM hts WHERE hts_number LIKE '3705%'");
  console.log('3705:', r5.map(r => `${r.hts_number}: ${r.description}`));
  await client.end();
}
run().catch(e => { console.error(e); process.exit(1); });
