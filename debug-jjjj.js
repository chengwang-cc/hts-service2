// Debug script to find which allow-rules are blocking EMPTY results
// Focus on ch.85, ch.84, ch.90, ch.39, ch.49 groups
const { Client } = require('pg');

const client = new Client({
  host: '192.168.1.209',
  port: 5432,
  user: 'postgres',
  password: 'wbroot0216',
  database: 'hts',
});

const queries = [
  // ch.85
  { q: 'man resin fridge magnet used', ch: '85' },
  { q: 'heted seat switch', ch: '85' },
  { q: '2005 infiniti g35 q45 fx35 press kit', ch: '85' },
  { q: 'damascus steel camping tool leather sheath', ch: '85' },
  { q: '2001 honda crv rd1 hazard switch', ch: '85' },
  // ch.84
  { q: 'steven barron', ch: '84' },
  { q: 'dell lexmark fuser dru0443', ch: '84' },
  { q: 'ball screw guards onefinity elite foreman', ch: '84' },
  { q: 'laser rotary extension plate fixture plate', ch: '84' },
  { q: 'nortel unitorch for glassworking', ch: '84' },
  // ch.90
  { q: '2x3 to 4x5 graflex graphic crown speed pacemaker adapter', ch: '90' },
  { q: 'custom made ccb 617c cone', ch: '90' },
  { q: 'cused canon dslr main pcb assy original parts', ch: '90' },
  { q: 'cheek retractors', ch: '90' },
  // ch.39
  { q: 'sanding anodizing powder coating protective tape ring makers tape', ch: '39' },
  { q: 'exhaust duct adapter elegoo resin 3d printers mars saturn', ch: '39' },
  { q: 'stick stitch baby monthly milestones hand embroidery pattern', ch: '39' },
  { q: 'handmade needlepoint doll', ch: '39' },
  { q: '14x11 photo album leatherette cover', ch: '39' },
  // ch.49
  { q: '1995 golden age comics chromium schomburg magnachrome insert card 3', ch: '49' },
  { q: '40 weeks baby bump accordion card fruit vegetable pregnancy baby shower gift', ch: '49' },
  { q: '2007 silver snail 31st anniversary newsprint poster signed adam hughes 17 26', ch: '49' },
  // ch.62
  { q: 'hand knitted wool outfit doll', ch: '62' },
  { q: 'vintage gap chore', ch: '62' },
  { q: 'handmade acacia wood tallit holders magen david judaica gift', ch: '62' },
  // ch.55
  { q: 'freetress 3x clean therapy braiding hair', ch: '55' },
  { q: 'tarot cloth teeth and bone', ch: '55' },
  { q: 'shiny metallic polyester korean yarn crochet bags', ch: '55' },
  // ch.48
  { q: 'softcover novel', ch: '48' },
  { q: 'ovo cup mcdonalds limited edition drake meal after hours', ch: '48' },
];

function tokenize(s) {
  return new Set(s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean));
}

function matchesPattern(pat, queryLower, tokens) {
  const anyOf = pat.anyOf || [];
  const noneOf = pat.noneOf || [];
  const required = pat.required || [];
  const anyOfGroups = pat.anyOfGroups || [];

  // noneOf check
  for (const t of noneOf) {
    if (t.includes(' ') ? queryLower.includes(t) : tokens.has(t)) return false;
  }

  // required check
  for (const t of required) {
    if (t.includes(' ') ? !queryLower.includes(t) : !tokens.has(t)) return false;
  }

  // anyOfGroups
  if (anyOfGroups.length > 0) {
    for (const group of anyOfGroups) {
      const groupMatches = group.some(t => t.includes(' ') ? queryLower.includes(t) : tokens.has(t));
      if (!groupMatches) return false;
    }
    return true;
  }

  // anyOf
  if (anyOf.length > 0) {
    return anyOf.some(t => t.includes(' ') ? queryLower.includes(t) : tokens.has(t));
  }

  return required.length > 0; // if only required, matched above
}

async function run() {
  await client.connect();
  const { rows: rules } = await client.query(
    "SELECT id, pattern, whitelist, priority FROM lookup_intent_rule WHERE whitelist IS NOT NULL AND (whitelist->>'allowChapters' IS NOT NULL OR whitelist->>'allowPrefixes' IS NOT NULL) ORDER BY priority DESC"
  );
  console.log(`Loaded ${rules.length} allow-rules from DB`);

  for (const { q, ch } of queries) {
    const queryLower = q.toLowerCase();
    const tokens = tokenize(q);
    const firing = [];
    for (const rule of rules) {
      const pat = rule.pattern || {};
      if (matchesPattern(pat, queryLower, tokens)) {
        const wl = rule.whitelist || {};
        firing.push({
          id: rule.id,
          allowChapters: wl.allowChapters || [],
          allowPrefixes: wl.allowPrefixes || [],
        });
      }
    }
    if (firing.length === 0) {
      console.log(`\n"${q}" [ch.${ch}] → NO allow rules fire (fused.size=0 likely)`);
    } else {
      const blockers = firing.filter(r => {
        if (r.allowChapters.length > 0 && !r.allowChapters.includes(ch)) return true;
        if (r.allowPrefixes.length > 0) {
          // check if any prefix starts with ch
          const anyChMatch = r.allowPrefixes.some(p => p.startsWith(ch));
          if (!anyChMatch) return true;
        }
        return false;
      });
      const helpers = firing.filter(r => !blockers.includes(r));
      if (blockers.length > 0) {
        console.log(`\n"${q}" [ch.${ch}] → BLOCKED by:`);
        for (const b of blockers) {
          console.log(`  ${b.id}: allowChapters=${JSON.stringify(b.allowChapters)} allowPrefixes=${JSON.stringify(b.allowPrefixes)}`);
        }
        if (helpers.length > 0) console.log(`  helpers: ${helpers.map(r=>r.id).join(', ')}`);
      } else {
        console.log(`\n"${q}" [ch.${ch}] → OK (${firing.length} rules allow ch.${ch})`);
      }
    }
  }

  await client.end();
}

run().catch(e => { console.error(e); process.exit(1); });
