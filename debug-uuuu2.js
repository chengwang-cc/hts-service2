const { Client } = require('pg');

async function main() {
  const client = new Client({ host: '192.168.1.209', port: 5432, user: 'postgres', password: 'wbroot0216', database: 'hts' });
  await client.connect();
  
  const { rows } = await client.query(`SELECT rule_id as id, pattern FROM lookup_intent_rule WHERE rule_id IN ('AI_CH19_PASTRY_CAKE','AI_CH45_CORK_MISC_ARTICLES')`);
  for (const r of rows) {
    console.log(`${r.id}:`);
    console.log('  anyOf:', r.pattern?.anyOf);
    console.log('  noneOf:', r.pattern?.noneOf?.slice(0,15));
    console.log();
  }
  
  await client.end();
}

main().catch(console.error);
