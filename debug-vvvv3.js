const { Client } = require('pg');

async function main() {
  const client = new Client({ host: '192.168.1.209', port: 5432, user: 'postgres', password: 'wbroot0216', database: 'hts' });
  await client.connect();
  
  const { rows } = await client.query(`SELECT rule_id as id, pattern FROM lookup_intent_rule WHERE rule_id = 'AI_CH93_GUN_PARTS_ACCESSORIES'`);
  const r = rows[0];
  console.log('Full anyOf:', r.pattern?.anyOf);
  console.log('Full noneOf:', r.pattern?.noneOf);
  
  // What matches 'fusion ultra grip'
  const ql = 'fusion ultra grip';
  const tokens = new Set(ql.split(' ').filter(Boolean));
  function match(t, ts, ql) { return t.includes(' ') ? ql.includes(t) : ts.has(t); }
  console.log('\nMatches:', r.pattern?.anyOf?.filter(t => match(t, tokens, ql)));
  
  await client.end();
}

main().catch(console.error);
