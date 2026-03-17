const { Client } = require('pg');
const client = new Client({ host: '192.168.1.209', port: 5432, user: 'postgres', password: 'wbroot0216', database: 'hts' });
async function run() {
  await client.connect();
  // Check AI_CH89_CARGO_CONTAINER and similar rules firing for "film container"
  const { rows: rules } = await client.query("SELECT rule_id, pattern, whitelist FROM lookup_intent_rule WHERE whitelist IS NOT NULL ORDER BY priority DESC");
  const q = 'Retro 135mm Film Container Holds 2 Rolls';
  const ql = q.toLowerCase();
  const tokens = new Set(ql.replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean));
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
  const firing = rules.filter(r => matchesPat(r.pattern, ql, tokens));
  console.log(`"${q}" fires:`);
  for (const r of firing) console.log(`  ${r.rule_id}: allowChapters=${JSON.stringify((r.whitelist||{}).allowChapters)}`);
  // Check 4202.12 entries
  const { rows: r2 } = await client.query("SELECT hts_number, description FROM hts WHERE hts_number LIKE '4202.12%' LIMIT 5");
  console.log('\n4202.12:', r2.map(r => `${r.hts_number}: ${r.description}`));
  // Check if 6301.10 has 10-digit entries
  const { rows: r3 } = await client.query("SELECT hts_number FROM hts WHERE hts_number LIKE '6301.10%'");
  console.log('6301.10:', r3.map(r => r.hts_number));
  await client.end();
}
run().catch(e => { console.error(e); process.exit(1); });
