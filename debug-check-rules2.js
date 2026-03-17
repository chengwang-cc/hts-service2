const { Client } = require('pg');
const client = new Client({ host: '192.168.1.209', port: 5432, user: 'postgres', password: 'wbroot0216', database: 'hts' });

const ruleIds = ['AI_CH66_WALKING_STICK','AI_CH31_ORGANIC_ANIMAL_FERTILIZER','AI_CH45_CORK_MISC_ARTICLES','AI_CH59_COATED_FABRIC_PVC_PU','AI_CH75_NICKEL_MESH_CLOTH','AI_CH13_NATURAL_GUMS_RESINS'];

async function run() {
  await client.connect();
  const { rows } = await client.query("SELECT rule_id, pattern FROM lookup_intent_rule WHERE rule_id = ANY($1)", [ruleIds]);
  for (const r of rows) {
    console.log(`\n${r.rule_id}:`);
    console.log(`  anyOf: ${JSON.stringify(r.pattern?.anyOf)}`);
    console.log(`  anyOfGroups: ${JSON.stringify(r.pattern?.anyOfGroups)}`);
    console.log(`  noneOf: ${JSON.stringify(r.pattern?.noneOf)}`);
  }
  await client.end();
}
run().catch(e => { console.error(e); process.exit(1); });
