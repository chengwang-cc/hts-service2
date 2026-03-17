const { Client } = require('pg');
const client = new Client({ host: '192.168.1.209', port: 5432, user: 'postgres', password: 'wbroot0216', database: 'hts' });
async function run() {
  await client.connect();
  // Check GEMSTONE_CABOCHON_INTENT current state
  const { rows: r1 } = await client.query("SELECT pattern, inject FROM lookup_intent_rule WHERE rule_id='GEMSTONE_CABOCHON_INTENT'");
  console.log('GEMSTONE_CABOCHON anyOf:', JSON.stringify(r1[0]?.pattern?.anyOf));
  console.log('GEMSTONE_CABOCHON inject:', JSON.stringify(r1[0]?.inject));
  
  // Check what fires for "crushed stone for inlaying"
  const { rows: rules } = await client.query("SELECT id, rule_id, pattern, whitelist FROM lookup_intent_rule WHERE whitelist IS NOT NULL ORDER BY priority DESC");
  const q = 'Crushed stone for inlaying and crafting'; const ql = q.toLowerCase();
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
  const ch = '71';
  const blockers = firing.filter(r => { const ac=(r.whitelist||{}).allowChapters||[]; return ac.length>0 && !ac.includes(ch); });
  console.log(`\n"${q}" BLOCKED: ${blockers.map(r=>r.rule_id).join(', ')||'none'}`);
  console.log(`  helpers: ${firing.filter(r=>!blockers.includes(r)).map(r=>r.rule_id).join(', ')||'none'}`);
  
  // Check 7105.90 entries 
  const { rows: r2 } = await client.query("SELECT hts_number FROM hts WHERE hts_number LIKE '7105%' AND LENGTH(REPLACE(hts_number,'.',''))=10");
  console.log('7105 10-digit:', r2.map(r => r.hts_number));
  
  // Check 7104.10 entries
  const { rows: r3 } = await client.query("SELECT hts_number, description FROM hts WHERE hts_number LIKE '7104.10%' LIMIT 3");
  console.log('7104.10:', r3.map(r => `${r.hts_number}: ${r.description}`));
  
  await client.end();
}
run().catch(e => { console.error(e); process.exit(1); });
