const { Client } = require('pg');

async function main() {
  const client = new Client({ host: '192.168.1.209', port: 5432, user: 'postgres', password: 'wbroot0216', database: 'hts' });
  await client.connect();
  
  const { rows } = await client.query(`SELECT rule_id as id, pattern, whitelist, inject FROM lookup_intent_rule WHERE rule_id IN ('GLASSWARE_DRINKING_INTENT','AI_CH45_CORK_MISC_ARTICLES','PRINTER_INTENT','PLATED_JEWELRY_INTENT')`);
  for (const r of rows) {
    console.log(`${r.id}:`);
    console.log('  anyOf:', r.pattern?.anyOf?.slice(0,8));
    console.log('  noneOf:', r.pattern?.noneOf?.slice(0,8));
    console.log('  allowChapters:', r.whitelist?.allowChapters);
    console.log('  inject:', r.inject?.slice(0,3));
    console.log();
  }
  
  await client.end();
}

main().catch(console.error);
