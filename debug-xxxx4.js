const { Client } = require('pg');

async function main() {
  const client = new Client({ host: '192.168.1.209', port: 5432, user: 'postgres', password: 'wbroot0216', database: 'hts' });
  await client.connect();
  
  const { rows: allRules } = await client.query(`SELECT rule_id as id, pattern, whitelist, inject FROM lookup_intent_rule WHERE rule_id IN ('3D_PRINT_PLASTIC_INTENT','ENCODER_INDUSTRIAL_INTENT','MANUFACTURING_INTENT')`);
  for (const r of allRules) {
    console.log(`${r.id}: inject=${JSON.stringify(r.inject?.slice(0,2))}, allowChapters=${JSON.stringify(r.whitelist?.allowChapters)}`);
  }
  
  await client.end();
}

main().catch(console.error);
