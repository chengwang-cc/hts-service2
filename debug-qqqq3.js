const { Client } = require('pg');
const client = new Client({ host: '192.168.1.209', port: 5432, user: 'postgres', password: 'wbroot0216', database: 'hts' });

async function run() {
  await client.connect();
  // Check if GARMENT rules fire for "vintage gap chore"
  const { rows: rules } = await client.query("SELECT rule_id, pattern, whitelist FROM lookup_intent_rule WHERE whitelist IS NOT NULL ORDER BY priority DESC");
  const q = 'vintage gap chore'; const ql = q.toLowerCase();
  const tokens = new Set(ql.replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean));
  
  function match(t, tokens, ql) { return t.includes(' ') ? ql.includes(t) : tokens.has(t); }
  function matchesPat(pat, ql, tokens) {
    if (!pat) return false;
    const anyOf = pat.anyOf || [], noneOf = pat.noneOf || [], groups = pat.anyOfGroups || [];
    if (anyOf.length > 0 && !anyOf.some(t => match(t, tokens, ql))) return false;
    for (const g of groups) if (!g.some(t => match(t, tokens, ql))) return false;
    for (const t of noneOf) if (match(t, tokens, ql)) return false;
    if (anyOf.length === 0 && groups.length === 0) return false;
    return true;
  }
  
  const firing = rules.filter(r => matchesPat(r.pattern, ql, tokens));
  if (firing.length > 0) {
    console.log(`"${q}" fires: ${firing.map(r => r.rule_id).join(', ')}`);
  } else {
    console.log(`"${q}" NO rules fire`);
  }
  
  // Check ch.92 for mouthpiece entries
  const { rows: r2 } = await client.query("SELECT hts_number, description FROM hts WHERE hts_number LIKE '9209.99%' LIMIT 5");
  console.log('9209.99:', r2.map(r => `${r.hts_number}: ${r.description}`));
  
  // Check if 9209.91 or 9209.99 has 10-digit entries
  const { rows: r3 } = await client.query("SELECT hts_number FROM hts WHERE hts_number LIKE '9209.91%' AND LENGTH(REPLACE(hts_number,'.',''))=10 LIMIT 3");
  console.log('9209.91 10-digit:', r3.map(r => r.hts_number));
  const { rows: r4 } = await client.query("SELECT hts_number FROM hts WHERE hts_number LIKE '9209.99%' AND LENGTH(REPLACE(hts_number,'.',''))=10 LIMIT 3");
  console.log('9209.99 10-digit:', r4.map(r => r.hts_number));
  
  // Check ch.82 for tool entries
  const { rows: r5 } = await client.query("SELECT hts_number, description FROM hts WHERE chapter='82' LIMIT 5");
  console.log('ch.82:', r5.map(r => `${r.hts_number}: ${r.description}`));
  
  await client.end();
}
run().catch(e => { console.error(e); process.exit(1); });
