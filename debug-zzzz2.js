const { Client } = require('pg');

async function main() {
  const client = new Client({ host: '192.168.1.209', port: 5432, user: 'postgres', password: 'wbroot0216', database: 'hts' });
  await client.connect();
  
  const { rows } = await client.query(`SELECT hts_number, description FROM hts WHERE hts_number LIKE '7106.10%' AND is_active = true ORDER BY hts_number LIMIT 10`);
  console.log('7106.10.xx codes:');
  rows.forEach(r => console.log(' ', r.hts_number, ':', r.description?.slice(0,60)));
  
  await client.end();
}

main().catch(console.error);
