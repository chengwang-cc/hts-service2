const { Client } = require('pg');

async function main() {
  const client = new Client({ host: '192.168.1.209', port: 5432, user: 'postgres', password: 'wbroot0216', database: 'hts' });
  await client.connect();
  
  const { rows: allRules } = await client.query(`SELECT rule_id as id, pattern, whitelist, inject FROM lookup_intent_rule`);
  
  function tokenize(s) { return new Set(s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean)); }
  function match(t, tokens, ql) { return t.includes(' ') ? ql.includes(t) : tokens.has(t); }
  function matchesPat(pat, ql, tokens) {
    if (pat.noneOf?.some(t => match(t, tokens, ql))) return false;
    if (pat.anyOfGroups?.length) {
      if (!pat.anyOfGroups.every(g => g.some(t => match(t, tokens, ql)))) return false;
    }
    if (pat.anyOf?.length) return pat.anyOf.some(t => match(t, tokens, ql));
    return true;
  }
  
  const queries = [
    ['310x310mm glass build surface 3d printer glass bed', '7005.29'],
    ['high density polyethylene hdpe plastic block 2 x 6 x 6', '3901.10'],
  ];
  
  for (const [q, expected] of queries) {
    const ql = q.toLowerCase().replace(/[^a-z0-9\s]/g, ' ');
    const tokens = tokenize(q);
    const fired = allRules.filter(r => matchesPat(r.pattern, ql, tokens));
    const withChapters = fired.filter(r => r.whitelist?.allowChapters);
    const withInject = fired.filter(r => r.inject?.length);
    const allChapters = new Set(withChapters.flatMap(r => r.whitelist.allowChapters));
    
    const expectedCh = expected.split('.')[0].slice(0,2);
    
    console.log(`"${q.slice(0,50)}":`);
    console.log(`  Expected: ${expected} (ch.${expectedCh})`);
    console.log(`  Allowed chapters from rules: [${[...allChapters].join(', ')}]`);
    console.log(`  Ch.${expectedCh} allowed: ${allChapters.size === 0 || allChapters.has(expectedCh)}`);
    console.log(`  Rules with inject:`, withInject.map(r => `${r.id}(${r.inject.slice(0,2).map(i=>i.prefix+':'+i.syntheticRank).join(',')})`).filter(n => !n.includes('AI_CH10')).join(', '));
    console.log();
  }
  
  await client.end();
}

main().catch(console.error);
