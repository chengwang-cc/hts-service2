const { Client } = require('pg');

async function main() {
  const client = new Client({ host: '192.168.1.209', port: 5432, user: 'postgres', password: 'wbroot0216', database: 'hts' });
  await client.connect();
  
  const { rows } = await client.query(`SELECT rule_id as id, pattern, whitelist, inject FROM lookup_intent_rule WHERE rule_id IN ('COFFEE_SINGLE_ORIGIN_INTENT','3D_PRINT_PLASTIC_INTENT')`);
  for (const r of rows) {
    console.log(`${r.id}:`);
    console.log('  anyOf:', r.pattern?.anyOf?.slice(0, 10));
    console.log('  allowChapters:', r.whitelist?.allowChapters);
    console.log('  inject:', r.inject?.slice(0,3));
  }
  
  // check if 'washed' matches coffee
  const ql = 'ecuador angamaza washed 300g';
  const tokens = new Set(ql.split(' ').filter(Boolean));
  const coffeeRow = rows.find(r => r.id === 'COFFEE_SINGLE_ORIGIN_INTENT');
  if (coffeeRow) {
    const match = (t) => t.includes(' ') ? ql.includes(t) : tokens.has(t);
    const matched = coffeeRow.pattern?.anyOf?.filter(match);
    console.log('\nCOFFEE match for "ecuador angamaza washed 300g":', matched);
  }
  
  await client.end();
}

main().catch(console.error);
