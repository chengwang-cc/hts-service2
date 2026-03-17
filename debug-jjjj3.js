// Corrected debug: anyOf AND anyOfGroups must BOTH match (AND logic)
const { Client } = require('pg');

const client = new Client({
  host: '192.168.1.209', port: 5432, user: 'postgres', password: 'wbroot0216', database: 'hts',
});

const queries = [
  { q: '2005 infiniti g35 q45 fx35 fx45 qx56 kuraza concept 2006 m35 m45 press kit', ch: '85' },
  { q: 'cused canon dslr main pcb assy original parts cg2-6528-010', ch: '90' },
  { q: 'ball screw guards onefinity elite foreman gen1 y-axis', ch: '84' },
  { q: '2x3 to 4x5 graflex graphic crown or speed pacemaker adapter', ch: '90' },
  { q: 'custom made ccb 617c cone', ch: '90' },
  { q: '14x11 photo album leatherette cover', ch: '39' },
  { q: '1995 golden age of comics all chromium schomburg magnachrome insert card 3', ch: '49' },
  { q: '40 weeks of baby bump accordion card fruit and vegetable pregnancy baby shower gift', ch: '49' },
  { q: '2007 silver snail 31st anniversary newsprint poster signed adam hughes 17 x 26', ch: '49' },
  { q: 'hand knitted wool outfit for a doll', ch: '62' },
  { q: 'freetress 3x clean therapy braiding hair 1b 52', ch: '55' },
  { q: 'tarot cloth teeth and bone', ch: '55' },
  { q: 'shiny metallic polyester korean yarn crochet bags crafts', ch: '55' },
  { q: 'ovo cup mcdonalds limited edition set of 2 drake meal after hours', ch: '48' },
  { q: 'sanding anodizing powder coating protective tape ring makers tape', ch: '39' },
  { q: 'exhaust duct adapter elegoo resin 3d printers mars saturn', ch: '39' },
  { q: 'man resin fridge magnet used', ch: '85' },
  { q: 'handmade needlepoint doll', ch: '39' },
  { q: 'heted seat switch', ch: '85' },
  { q: 'laser rotary extension plate fixture plate', ch: '84' },
  { q: 'damascus steel camping tool leather sheath', ch: '85' },
];

function tokenize(s) {
  return new Set(s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean));
}

function tokenOrPhraseMatches(t, tokens, queryLower) {
  return t.includes(' ') ? queryLower.includes(t) : tokens.has(t);
}

function matchesPattern(pat, queryLower, tokens) {
  if (!pat) return false;
  const anyOf = pat.anyOf || [];
  const noneOf = pat.noneOf || [];
  const anyOfGroups = pat.anyOfGroups || [];

  // anyOf: at least one must match (if anyOf is non-empty)
  if (anyOf.length > 0) {
    if (!anyOf.some(t => tokenOrPhraseMatches(t, tokens, queryLower))) return false;
  }

  // anyOfGroups: each group must have at least one match
  for (const group of anyOfGroups) {
    if (!group.some(t => tokenOrPhraseMatches(t, tokens, queryLower))) return false;
  }

  // noneOf: none can match
  for (const t of noneOf) {
    if (tokenOrPhraseMatches(t, tokens, queryLower)) return false;
  }

  // If no anyOf and no anyOfGroups, rule only matches if it has no constraints (catch-all)
  if (anyOf.length === 0 && anyOfGroups.length === 0) return false; // skip empty patterns

  return true;
}

async function run() {
  await client.connect();
  const { rows: rules } = await client.query(
    "SELECT id, rule_id, pattern, whitelist FROM lookup_intent_rule WHERE whitelist IS NOT NULL AND (whitelist->>'allowChapters' IS NOT NULL OR whitelist->>'allowPrefixes' IS NOT NULL) ORDER BY priority DESC"
  );
  console.log(`Loaded ${rules.length} allow-rules from DB`);

  for (const { q, ch } of queries) {
    const queryLower = q.toLowerCase();
    const tokens = tokenize(q);
    const firing = [];
    for (const rule of rules) {
      if (matchesPattern(rule.pattern, queryLower, tokens)) {
        const wl = rule.whitelist || {};
        firing.push({ id: rule.id, ruleId: rule.rule_id, allowChapters: wl.allowChapters || [], allowPrefixes: wl.allowPrefixes || [] });
      }
    }
    const blockers = firing.filter(r => {
      const chOk = r.allowChapters.length === 0 || r.allowChapters.includes(ch);
      const pfxOk = r.allowPrefixes.length === 0 || r.allowPrefixes.some(p => p.startsWith(ch));
      return !(chOk && pfxOk);
    });
    const helpers = firing.filter(r => !blockers.includes(r));
    if (blockers.length > 0) {
      console.log(`\n"${q}" [ch.${ch}] → BLOCKED by:`);
      for (const b of blockers) {
        const matchingTerms = [...(b.ruleId ? [] : [])]; // placeholder
        console.log(`  ${b.ruleId} [${b.id.slice(0,8)}]: allowChapters=${JSON.stringify(b.allowChapters)} allowPrefixes=${JSON.stringify(b.allowPrefixes)}`);
      }
      if (helpers.length > 0) console.log(`  helpers: ${helpers.map(r=>r.ruleId).join(', ')}`);
    } else if (firing.length === 0) {
      console.log(`\n"${q}" [ch.${ch}] → NO rules fire`);
    } else {
      console.log(`\n"${q}" [ch.${ch}] → OK (helpers only: ${helpers.map(r=>r.ruleId).join(', ')})`);
    }
  }
  await client.end();
}

run().catch(e => { console.error(e); process.exit(1); });
