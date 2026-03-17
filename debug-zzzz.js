const { Client } = require('pg');

async function main() {
  const client = new Client({ host: '192.168.1.209', port: 5432, user: 'postgres', password: 'wbroot0216', database: 'hts' });
  await client.connect();
  
  // Check if 7106.10.xx codes exist
  const { rows } = await client.query(`SELECT "htsNumber", description FROM hts WHERE "htsNumber" LIKE '7106.10%' AND "isActive" = true ORDER BY "htsNumber" LIMIT 10`);
  console.log('7106.10.xx codes:', rows.map(r => `${r.htsNumber}: ${r.description}`));
  
  // Also check 7114.11
  const { rows: r2 } = await client.query(`SELECT "htsNumber", description FROM hts WHERE "htsNumber" LIKE '7114.11%' AND "isActive" = true LIMIT 5`);
  console.log('7114.11.xx codes:', r2.map(r => `${r.htsNumber}: ${r.description}`));
  
  await client.end();
}

main().catch(console.error);
