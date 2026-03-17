const { Client } = require('pg');
const client = new Client({ host: '192.168.1.209', port: 5432, user: 'postgres', password: 'wbroot0216', database: 'hts' });
async function run() {
  await client.connect();
  const { rows } = await client.query("SELECT pattern FROM lookup_intent_rule WHERE rule_id='AI_CH45_CORK_RAW'");
  const pat = rows[0]?.pattern;
  console.log('AI_CH45_CORK_RAW anyOf:', JSON.stringify(pat?.anyOf));
  console.log('AI_CH45_CORK_RAW noneOf:', JSON.stringify(pat?.noneOf));
  
  // Test manually
  const q = 'Crushed stone for inlaying and crafting';
  const ql = q.toLowerCase();
  const tokens = new Set(ql.replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean));
  console.log('\nTokens:', [...tokens]);
  const anyOf = pat?.anyOf || [];
  const noneOf = pat?.noneOf || [];
  function match(t, tok, ql) { return t.includes(' ') ? ql.includes(t) : tok.has(t); }
  
  const matchingAnyOf = anyOf.filter(t => match(t, tokens, ql));
  console.log('Matching anyOf:', matchingAnyOf);
  const matchingNoneOf = noneOf.filter(t => match(t, tokens, ql));
  console.log('Matching noneOf:', matchingNoneOf);
  console.log('Rule fires:', matchingAnyOf.length > 0 && matchingNoneOf.length === 0);
  await client.end();
}
run().catch(e => { console.error(e); process.exit(1); });
