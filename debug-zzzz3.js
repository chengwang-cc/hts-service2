const { Client } = require('pg');

async function main() {
  const client = new Client({ host: '192.168.1.209', port: 5432, user: 'postgres', password: 'wbroot0216', database: 'hts' });
  await client.connect();
  
  const { rows } = await client.query(`SELECT hts_number, description, full_description FROM hts WHERE hts_number LIKE '7001.00%' AND is_active = true ORDER BY hts_number LIMIT 5`);
  rows.forEach(r => console.log(r.hts_number, ':', r.description, '|', JSON.stringify(r.full_description)?.slice(0,100)));
  
  await client.end();
}

main().catch(console.error);
