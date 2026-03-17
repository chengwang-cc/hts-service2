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
    'plastic press on nails',
    'rotisserie bbq motor',
    'mobile tempered glass',
    'handmade fabric clutch purse',
    'printed paper',
  ];
  
  for (const q of queries) {
    const ql = q.toLowerCase().replace(/[^a-z0-9\s]/g, ' ');
    const tokens = tokenize(q);
    const fired = allRules.filter(r => matchesPat(r.pattern, ql, tokens));
    const withChapters = fired.filter(r => r.whitelist?.allowChapters);
    const withInject = fired.filter(r => r.inject?.length);
    
    console.log(`"${q}":`);
    if (withChapters.length) {
      console.log(`  BLOCKING: ${withChapters.map(r => `${r.id}→[${r.whitelist.allowChapters}]`).join(', ')}`);
    }
    const relevantInject = withInject.filter(r => !['AI_CH10_QUINOA','AI_CH10_FONIO','AI_CH10_TRITICALE','AI_CH10_GRAIN_SORGHUM_SEED'].includes(r.id));
    if (relevantInject.length) {
      console.log(`  Inject: ${relevantInject.map(r => `${r.id}(${r.inject.slice(0,2).map(i=>i.prefix).join(',')})`).join(', ')}`);
    }
    console.log();
  }
  
  await client.end();
}

main().catch(console.error);
