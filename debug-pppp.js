const { Client } = require('pg');
const client = new Client({ host: '192.168.1.209', port: 5432, user: 'postgres', password: 'wbroot0216', database: 'hts' });

const queries = [
  { q: 'cloth dog toy', ch: '42' },
  { q: 'dog toy squeaky', ch: '42' },
  { q: 'cat toy feather', ch: '42' },
  { q: 'family portrait', ch: '37' },
  { q: 'leather case key fob', ch: '41' },
  { q: 'Paper pkg scour powder', ch: '34' },
  { q: 'Thunda Slouch - Brunette', ch: '61' },
  { q: 'Step Encoder', ch: '85' },
  { q: 'Cargo Carrier, Collapsible', ch: '87' },
  { q: 'Procentec ProfitraceV2.9.7', ch: '90' },
  { q: 'RM - Nylon Coated Metal Sliders Rings', ch: '96' },
  { q: 'Mazda O2 sensor', ch: '98' },
  { q: 'man resin fridge magn (used)', ch: '85' },
  { q: 'Ecuador, Angamaza Washed (300g)', ch: '9' },
  { q: 'Rustic Farmhouse Wall Shelf with Hooks Handmade Reclaimed Wood Entryway Organizer Distressed Nautical Coastal Blue White Gray Coat Rack', ch: '44' },
  { q: 'CONCRETE SHAVE BOWL/BRUSH', ch: '68' },
  { q: 'Easter craftkit: colorful paper, shells, ribbons', ch: '68' },
  { q: 'V2 Stagger Swagger - Neck / Full Gold', ch: '92' },
  { q: 'BG A11 L Mouthpiece Patch, Clear, Large 0.4mm', ch: '92' },
  { q: '36 Toppers - 6 Faces', ch: '95' },
  { q: 'TwistLace V3 Accessory', ch: '95' },
  { q: 'Stardew Valley Acrylic Charms - Double Sided', ch: '82' },
  { q: 'Door Webbing Travel Accessory', ch: '76' },
  { q: 'Umbreon VMAX 215/203', ch: '76' },
  { q: 'Khanda Sikh Baaj Salai and Pagg Pin for Turban', ch: '74' },
  { q: 'Personalized Nikah Ring Tray Arabic Calligraphy Pearl Border dried baby breath', ch: '70' },
  { q: 'Cute Die Cut Mousepad Original Fanart Animals Strawberry Aesthetic Kawaii Bunny', ch: '59' },
  { q: 'Glass btl lqd tan extract', ch: '32' },
  { q: 'Algonquin - 330g', ch: '32' },
  { q: 'Stick and Stitch Baby Monthly Milestones Hand Embroidery Pattern newborn baby gift', ch: '39' },
  { q: '3D Printed Dremel/Proxxon Organizer - 168 Slot', ch: '39' },
  { q: 'vintage gap chore', ch: '62' },
  { q: 'Handmade Acacia Wood Tallit Holders Magen David Judaica Gift', ch: '62' },
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
      const wl = r.whitelist || {};
      const ac = wl.allowChapters || [];
      return ac.length > 0 && !ac.includes(ch);
    });
    const helpers = firing.filter(r => !blockers.includes(r));
    if (blockers.length > 0) {
      console.log(`\n"${q.slice(0,60)}" [ch.${ch}] BLOCKED:`);
      for (const b of blockers) console.log(`  ${b.rule_id}: allowChapters=${JSON.stringify((b.whitelist||{}).allowChapters)}`);
      if (helpers.length) console.log(`  helpers: ${helpers.map(r=>r.rule_id).join(', ')}`);
    } else if (firing.length === 0) {
      console.log(`\n"${q.slice(0,60)}" [ch.${ch}] → NO rules fire`);
      if (helpers.length) console.log(`  helpers: ${helpers.map(r=>r.rule_id).join(', ')}`);
    } else {
      console.log(`\n"${q.slice(0,60)}" [ch.${ch}] → OK: ${helpers.map(r=>r.rule_id).join(', ')}`);
    }
  }
  await client.end();
}
run().catch(e => { console.error(e); process.exit(1); });
