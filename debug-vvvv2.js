const { Client } = require('pg');

async function main() {
  const client = new Client({ host: '192.168.1.209', port: 5432, user: 'postgres', password: 'wbroot0216', database: 'hts' });
  await client.connect();
  
  const { rows } = await client.query(`SELECT rule_id as id, pattern, whitelist, inject, boosts FROM lookup_intent_rule WHERE rule_id IN ('PLATED_JEWELRY_INTENT','AI_CH93_GUN_PARTS_ACCESSORIES','RESIN_EPOXY_LIQUID_POLYMER_INTENT','JEWELRY_NECKLACE_INTENT','JEWELRY_EARRING_INTENT')`);
  for (const r of rows) {
    console.log(`${r.id}:`);
    console.log('  anyOf (first 8):', r.pattern?.anyOf?.slice(0,8));
    console.log('  noneOf (first 5):', r.pattern?.noneOf?.slice(0,5));
    console.log('  allowChapters:', r.whitelist?.allowChapters);
    console.log('  inject:', r.inject?.slice(0,3));
    console.log('  boosts:', r.boosts?.slice(0,3));
    console.log();
  }
  
  await client.end();
}

main().catch(console.error);
