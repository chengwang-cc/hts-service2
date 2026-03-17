const { Client } = require('pg');
const client = new Client({ host: '192.168.1.209', port: 5432, user: 'postgres', password: 'wbroot0216', database: 'hts' });

const queries = [
  { q: 'semi precious marble', ch: '71' },
  { q: 'semi precious marbles', ch: '71' },
  { q: 'heart shaped quartz', ch: '71' },
  { q: 'Rainbow tourmaline beaded bracelet', ch: '71' },
  { q: '1 Ring Leather Pet Necklace', ch: '42' },
  { q: 'Retro 135mm Film Container Holds 2 Rolls', ch: '42' },
  { q: 'Cold Color Yuzen Chiyogami Washi Origami Paper', ch: '48' },
  { q: 'motorcycle tire blamket', ch: '63' },
  { q: 'Deltarune Mini Tenna Deco Sticker Sheet', ch: '48' },
];

function tokenize(s) { return new Set(s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean)); }
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

async function run() {
  await client.connect();
  const { rows: rules } = await client.query("SELECT id, rule_id, pattern, whitelist FROM lookup_intent_rule WHERE whitelist IS NOT NULL ORDER BY priority DESC");
  for (const { q, ch } of queries) {
    const ql = q.toLowerCase(); const tokens = tokenize(q);
    const firing = rules.filter(r => matchesPat(r.pattern, ql, tokens));
    const blockers = firing.filter(r => { const ac=(r.whitelist||{}).allowChapters||[]; return ac.length>0 && !ac.includes(ch); });
    const helpers = firing.filter(r => !blockers.includes(r));
    if (blockers.length > 0) {
      console.log(`\n"${q.slice(0,55)}" [ch.${ch}] BLOCKED: ${blockers.map(r=>r.rule_id).join(', ')}`);
    } else if (firing.length === 0) {
      console.log(`\n"${q.slice(0,55)}" [ch.${ch}] NO rules fire`);
    } else {
      console.log(`\n"${q.slice(0,55)}" [ch.${ch}] OK - helpers: ${helpers.map(r=>r.rule_id).join(', ')}`);
    }
  }
  await client.end();
}
run().catch(e => { console.error(e); process.exit(1); });
