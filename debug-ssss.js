const { Client } = require('pg');
const client = new Client({ host: '192.168.1.209', port: 5432, user: 'postgres', password: 'wbroot0216', database: 'hts' });
async function run() {
  await client.connect();
  // Check if JEWELRY_NECKLACE_INTENT noneOf was updated
  const { rows: r1 } = await client.query("SELECT rule_id, pattern FROM lookup_intent_rule WHERE rule_id='JEWELRY_NECKLACE_INTENT'");
  console.log('JEWELRY_NECKLACE_INTENT noneOf:', JSON.stringify(r1[0]?.pattern?.noneOf));
  
  // Check what rules fire for "1 Ring Leather Pet Necklace"
  const { rows: rules } = await client.query("SELECT id, rule_id, pattern, whitelist FROM lookup_intent_rule WHERE whitelist IS NOT NULL ORDER BY priority DESC");
  const q = '1 Ring Leather Pet Necklace'; const ql = q.toLowerCase();
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
  const ch = '42';
  const blockers = firing.filter(r => { const ac=(r.whitelist||{}).allowChapters||[]; return ac.length>0 && !ac.includes(ch); });
  const helpers = firing.filter(r => !blockers.includes(r));
  console.log(`\n"${q}" BLOCKED: ${blockers.map(r=>r.rule_id).join(', ')||'none'}`);
  console.log(`  helpers: ${helpers.map(r=>r.rule_id).join(', ')||'none'}`);
  
  await client.end();
}
run().catch(e => { console.error(e); process.exit(1); });
