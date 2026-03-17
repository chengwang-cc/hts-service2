const { Client } = require('pg');
const client = new Client({ host: '192.168.1.209', port: 5432, user: 'postgres', password: 'wbroot0216', database: 'hts' });
async function run() {
  await client.connect();
  // Check what fires for stained glass suncatcher
  const { rows: rules } = await client.query("SELECT id, rule_id, pattern, whitelist FROM lookup_intent_rule WHERE whitelist IS NOT NULL ORDER BY priority DESC");
  
  const queries = [
    {q: 'stained glass chickadee suncatcher home decor', ch: '70'},
    {q: 'iPhone Air Tempered Glass Screen Protector 9H Hardness', ch: '70'},
    {q: '2.75 lbs Assorted Creation is Messy Glass', ch: '70'},
    {q: 'Silly Persona 3 Stickers', ch: '48'},
    {q: 'crystal figurine', ch: '70'},
  ];
  
  function tokenize(s) { return new Set(s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean)); }
  function match(t, tok, ql) { return t.includes(' ') ? ql.includes(t) : tok.has(t); }
  function matchesPat(pat, ql, tok) {
    if (!pat) return false;
    const anyOf = pat.anyOf || [], noneOf = pat.noneOf || [], groups = pat.anyOfGroups || [];
    if (anyOf.length > 0 && !anyOf.some(t => match(t, tok, ql))) return false;
    for (const g of groups) if (!g.some(t => match(t, tok, ql))) return false;
    for (const t of noneOf) if (match(t, tok, ql)) return false;
    if (anyOf.length === 0 && groups.length === 0) return false;
    return true;
  }
  
  for (const {q, ch} of queries) {
    const ql = q.toLowerCase(); const tokens = tokenize(q);
    const firing = rules.filter(r => matchesPat(r.pattern, ql, tokens));
    const blockers = firing.filter(r => { const ac=(r.whitelist||{}).allowChapters||[]; return ac.length>0 && !ac.includes(ch); });
    const helpers = firing.filter(r => !blockers.includes(r));
    if (blockers.length > 0) {
      console.log(`"${q.slice(0,50)}" BLOCKED: ${blockers.map(r=>r.rule_id).join(', ')}`);
    } else if (firing.length === 0) {
      console.log(`"${q.slice(0,50)}" NO rules fire`);
    } else {
      console.log(`"${q.slice(0,50)}" OK - helpers: ${helpers.map(r=>r.rule_id).join(', ')}`);
    }
  }
  
  // Check 7003/7004/7005 HTS entries
  const { rows: r2 } = await client.query("SELECT hts_number, description FROM hts WHERE hts_number LIKE '7003.19%' LIMIT 3");
  console.log('\n7003.19:', r2.map(r => `${r.hts_number}: ${r.description}`));
  const { rows: r3 } = await client.query("SELECT hts_number FROM hts WHERE hts_number LIKE '7003.19%' AND LENGTH(REPLACE(hts_number,'.',''))=10 LIMIT 3");
  console.log('7003.19 10-digit:', r3.map(r => r.hts_number));
  const { rows: r4 } = await client.query("SELECT hts_number FROM hts WHERE hts_number LIKE '7007.19%' AND LENGTH(REPLACE(hts_number,'.',''))=10 LIMIT 3");
  console.log('7007.19 10-digit:', r4.map(r => r.hts_number));
  const { rows: r5 } = await client.query("SELECT hts_number FROM hts WHERE hts_number LIKE '7002.20%' AND LENGTH(REPLACE(hts_number,'.',''))=10 LIMIT 3");
  console.log('7002.20 10-digit:', r5.map(r => r.hts_number));
  
  await client.end();
}
run().catch(e => { console.error(e); process.exit(1); });
