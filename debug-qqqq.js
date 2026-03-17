const { Client } = require('pg');
const client = new Client({ host: '192.168.1.209', port: 5432, user: 'postgres', password: 'wbroot0216', database: 'hts' });

const queries = [
  { q: '70/20/10 Wool/Cashmere/Nylon YarnKit - Nicaragua - Black / Huron', ch: '51' },
  { q: '3D Printed Dremel/Proxxon Organizer - 168 Slot', ch: '39' },
  { q: 'Stick and Stitch Baby Monthly Milestones Hand Embroidery Pattern', ch: '39' },
  { q: 'vintage gap chore', ch: '62' },
  { q: 'Handmade Acacia Wood Tallit Holders Magen David Judaica Gift', ch: '62' },
  { q: 'Stardew Valley Acrylic Charms - Double Sided', ch: '82' },
  { q: 'Edelbrock 4025 unisyn', ch: '82' },
  { q: 'Thunda Slouch - Brunette', ch: '61' },
  { q: 'Khanda Sikh Baaj Salai and Pagg Pin for Turban Patka Dumala', ch: '74' },
  { q: 'BG A11 L Mouthpiece Patch Clear Large 0.4mm 6 Count', ch: '92' },
  { q: 'TwistLace V3 Accessory', ch: '95' },
  { q: '1x 7115 and 3 of the 7469', ch: '51' },
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
  const { rows: rules } = await client.query(
    "SELECT id, rule_id, pattern, whitelist FROM lookup_intent_rule WHERE whitelist IS NOT NULL ORDER BY priority DESC"
  );
  for (const { q, ch } of queries) {
    const ql = q.toLowerCase(); const tokens = tokenize(q);
    const firing = rules.filter(r => matchesPat(r.pattern, ql, tokens));
    const blockers = firing.filter(r => {
      const ac = (r.whitelist||{}).allowChapters || [];
      return ac.length > 0 && !ac.includes(ch);
    });
    const helpers = firing.filter(r => !blockers.includes(r));
    if (blockers.length > 0) {
      console.log(`\n"${q.slice(0,55)}" [ch.${ch}] BLOCKED:`);
      for (const b of blockers) console.log(`  ${b.rule_id}: allowChapters=${JSON.stringify((b.whitelist||{}).allowChapters)}`);
      if (helpers.length) console.log(`  helpers: ${helpers.map(r=>r.rule_id).join(', ')}`);
    } else if (firing.length === 0) {
      console.log(`\n"${q.slice(0,55)}" [ch.${ch}] → NO rules fire`);
    } else {
      console.log(`\n"${q.slice(0,55)}" [ch.${ch}] → OK: ${helpers.map(r=>r.rule_id).join(', ')}`);
    }
  }
  await client.end();
}
run().catch(e => { console.error(e); process.exit(1); });
