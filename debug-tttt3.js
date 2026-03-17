const { Client } = require('pg');

async function main() {
  const client = new Client({ host: '192.168.1.209', port: 5432, user: 'postgres', password: 'wbroot0216', database: 'hts' });
  await client.connect();
  
  const targetIds = ['STAINED_GLASS_FLAT_INTENT','TEMPERED_GLASS_SCREEN_INTENT','GLASS_ROD_LAMPWORK_INTENT','STICKER_SHEET_PAPER_INTENT','BONE_CHINA_CERAMIC_DISHWARE_INTENT','AI_CH75_NICKEL_MESH_CLOTH'];
  const { rows } = await client.query(`SELECT rule_id as id, pattern, whitelist FROM lookup_intent_rule WHERE rule_id = ANY($1)`, [targetIds]);
  
  function tokenize(s) { return new Set(s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean)); }
  function match(t, tokens, ql) { return t.includes(' ') ? ql.includes(t) : tokens.has(t); }
  function matchesPat(pat, ql, tokens) {
    if (pat.noneOf?.some(t => match(t, tokens, ql))) return false;
    if (pat.anyOf?.length) return pat.anyOf.some(t => match(t, tokens, ql));
    return true;
  }
  
  const queries = [
    'crystal figurine', '310x310mm glass build surface 3d printer glass bed', 'bridal party banner',
    'stained glass chickadee suncatcher', 'iphone air tempered glass screen protector',
    'silly persona 3 stickers', 'creation is messy boro glass rods',
    '14k gold jewelry', 'sterling silver shavings',
  ];
  
  for (const q of queries) {
    const ql = q.toLowerCase().replace(/[^a-z0-9\s]/g, ' ');
    const tokens = tokenize(q);
    const fired = [];
    for (const r of rows) {
      if (matchesPat(r.pattern, ql, tokens)) fired.push(r.id + '(' + JSON.stringify(r.whitelist?.allowChapters) + ')');
    }
    console.log(`"${q}" → ${fired.length ? fired.join(', ') : 'NO MATCH'}`);
  }
  
  await client.end();
}

main().catch(console.error);
