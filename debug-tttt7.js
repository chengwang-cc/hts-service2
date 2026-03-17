const { Client } = require('pg');

async function main() {
  const client = new Client({ host: '192.168.1.209', port: 5432, user: 'postgres', password: 'wbroot0216', database: 'hts' });
  await client.connect();
  
  const { rows } = await client.query(`SELECT rule_id as id, pattern FROM lookup_intent_rule WHERE rule_id = 'GLASSWARE_DRINKING_INTENT'`);
  const r = rows[0];
  console.log('anyOf (full):', r.pattern?.anyOf);
  
  const ql = 'crystal figurine';
  const tokens = new Set(ql.split(' ').filter(Boolean));
  function match(t, ts, ql) { return t.includes(' ') ? ql.includes(t) : ts.has(t); }
  const matchedAnyOf = r.pattern?.anyOf?.filter(t => match(t, tokens, ql));
  console.log('For "crystal figurine" matched anyOf:', matchedAnyOf);
  
  await client.end();
}

main().catch(console.error);
