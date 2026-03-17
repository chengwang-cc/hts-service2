const { Client } = require('pg');

async function main() {
  const client = new Client({ host: '192.168.1.209', port: 5432, user: 'postgres', password: 'wbroot0216', database: 'hts' });
  await client.connect();
  
  const { rows } = await client.query(`SELECT rule_id as id, pattern, whitelist FROM lookup_intent_rule WHERE rule_id IN ('LEATHER_JACKET_INTENT','OUTERWEAR_INTENT')`);
  for (const r of rows) {
    console.log(`${r.id}:`);
    console.log('  anyOf:', r.pattern?.anyOf);
    console.log('  noneOf:', r.pattern?.noneOf?.slice(0,10));
    console.log('  allowChapters:', r.whitelist?.allowChapters);
    console.log();
  }
  
  // Check: which ch.62 expected queries are being blocked by LEATHER_JACKET_INTENT?
  const { rows: allRules } = await client.query(`SELECT rule_id as id, pattern, whitelist FROM lookup_intent_rule WHERE rule_id = 'LEATHER_JACKET_INTENT'`);
  const leatherRule = allRules[0];
  
  function tokenize(s) { return new Set(s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean)); }
  function match(t, tokens, ql) { return t.includes(' ') ? ql.includes(t) : tokens.has(t); }
  function matchesPat(pat, ql, tokens) {
    if (pat.noneOf?.some(t => match(t, tokens, ql))) return false;
    if (pat.anyOf?.length) return pat.anyOf.some(t => match(t, tokens, ql));
    return true;
  }
  
  const testQueries = [
    'man winter jacket', '50% leather 50% acrylic male jacket', 'used 100% leather jacket',
    'nylon jacket', 'mens jacket', 'reversible jacket', 'chore coat', 'field coat',
    'leather handbag', 'leather wallet', 'leather belt',
  ];
  
  console.log('LEATHER_JACKET_INTENT firing for:');
  for (const q of testQueries) {
    const ql = q.toLowerCase().replace(/[^a-z0-9\s]/g, ' ');
    const tokens = tokenize(q);
    if (matchesPat(leatherRule.pattern, ql, tokens)) {
      console.log('  YES:', q);
    }
  }
  
  await client.end();
}

main().catch(console.error);
