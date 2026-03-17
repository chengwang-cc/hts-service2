const { Client } = require('pg');

async function main() {
  const client = new Client({ host: '192.168.1.209', port: 5432, user: 'postgres', password: 'wbroot0216', database: 'hts' });
  await client.connect();
  
  const { rows } = await client.query(`SELECT rule_id as id, pattern FROM lookup_intent_rule WHERE rule_id = 'AI_CH45_CORK_MISC_ARTICLES'`);
  const r = rows[0];
  console.log('AI_CH45_CORK_MISC_ARTICLES anyOf:', r.pattern?.anyOf);
  console.log('noneOf:', r.pattern?.noneOf?.slice(0,20));
  
  // check for 'block'
  const ql = 'high density polyethylene hdpe plastic block 2 x 6 x 6';
  const tokens = new Set(ql.split(' ').filter(Boolean));
  function match(t, ts, ql) { return t.includes(' ') ? ql.includes(t) : ts.has(t); }
  
  const matchedAnyOf = r.pattern?.anyOf?.filter(t => match(t, tokens, ql));
  const matchedNoneOf = r.pattern?.noneOf?.filter(t => match(t, tokens, ql));
  console.log('\nFor "hdpe plastic block":');
  console.log('  matchedAnyOf:', matchedAnyOf);
  console.log('  matchedNoneOf:', matchedNoneOf);
  
  await client.end();
}

main().catch(console.error);
