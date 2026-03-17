const { Client } = require('pg');

async function main() {
  const client = new Client({ host: '192.168.1.209', port: 5432, user: 'postgres', password: 'wbroot0216', database: 'hts' });
  await client.connect();
  
  const { rows } = await client.query(`SELECT rule_id as id, pattern, whitelist, inject FROM lookup_intent_rule WHERE rule_id IN ('TOILET_PAPER_INTENT','CLUTCH_BAG_INTENT','SCREEN_PROTECTOR_INTENT','TEMPERED_GLASS_SCREEN_INTENT')`);
  for (const r of rows) {
    console.log(`${r.id}:`);
    console.log('  anyOf (first 10):', r.pattern?.anyOf?.slice(0,10));
    console.log('  noneOf:', r.pattern?.noneOf?.slice(0,8));
    console.log('  allowChapters:', r.whitelist?.allowChapters);
    console.log('  inject:', r.inject?.slice(0,4));
    console.log();
  }
  
  // Check what matches "printed paper"
  const ql = 'printed paper';
  const tokens = new Set(ql.split(' ').filter(Boolean));
  const tp = rows.find(r => r.id === 'TOILET_PAPER_INTENT');
  if (tp) {
    const match = (t) => t.includes(' ') ? ql.includes(t) : tokens.has(t);
    console.log('TOILET_PAPER_INTENT matches for "printed paper":', tp.pattern?.anyOf?.filter(match));
  }
  
  await client.end();
}

main().catch(console.error);
