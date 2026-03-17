// Show rule names for blocking rules
const { Client } = require('pg');

const client = new Client({
  host: '192.168.1.209',
  port: 5432,
  user: 'postgres',
  password: 'wbroot0216',
  database: 'hts',
});

// UUIDs from the debug output that are BLOCKERS
const uuidsOfInterest = [
  '699a7dd4-f2d6-437f-a16a-f78768f5737b', // ch.13, resin
  'e193cfeb-ed3a-4dd5-ab58-305a7f7e5937', // prefix 3926.
  '2089fec4-7a83-4015-b5f9-550f6089fae2', // ch.67, seat/laser
  'cef5b43b-4d38-43fb-87c6-110a80a1f347', // ch.06, press
  '3bcd131e-2da9-4200-b6fd-1ae7e7f7e8a3', // ch.40, sheath/leather
  '841a79f8-2ca8-44b2-a465-e26c550ddf65', // ch.73, screw
  '69e85208-e960-44b4-8101-ab35482ef9cd', // ch.48, graphic
  '5106c733-e711-41b9-9b5c-64ab4ac5c22e', // ch.19, cone (may be wrong UUID)
  '5106c733-e711-41b9-9b5c-64ab8675669e', // ch.19, cone
  'e9e1aa2f-b95f-437d-b922-6697900caf56', // ch.92, assy
  '9c287e68-9833-4125-a9b2-2f385f9fc1b6', // ch.84, pcb
  '1c291bf4-b038-4c37-a32e-9019bf0ceac1', // ch.40, tape
  '54c2d248-aa4f-4c5d-8b8a-ac13a7b64a2a', // ch.18, coating
  'fc67b27a-560d-449a-af6b-679e6c4d445c', // ch.11, cup
  '473ac47b-490a-4ed4-a7d9-7c1c0ae7e2cc', // ch.36, powder - may be wrong
  '016f781a-d709-4511-a716-31ca38ca283f', // ch.37, photo album
  '41cb0cd2-0e2b-4771-b170-1622d4add94f', // ch.37, photo album
  '461ba7b5-f7aa-4a50-a5a6-9977059ffe30', // ch.49, photo album
  '2f989ba7-8b1b-4131-91b9-108cc1339e35', // ch.17, golden/chromium
  '7dfe2d2e-a530-419f-ab28-a23a2add5328', // ch.08, FRESH_FRUIT
  '5fef3f95-ce2f-465f-a554-91f366a7e505', // ch.07, FRESH_VEGETABLE
  'cd723e18-6c49-411e-bd84-0b77a8d9988f', // ch.47, newsprint
  'cd1e0ec6-1460-435d-8b90-6b43c1adabda', // ch.60, knitted
  '2411c533-07c9-4d50-b7e9-e7ad3386aba6', // ch.60
  'c337ee28-2135-4cd7-926c-2dcba4ac9529', // ch.60
  '5e887665-cf2a-456a-bded-966b86e21a3a', // ch.63
  '1d263697-1e31-4401-914f-2494814d11dc', // ch.60
  'c87eb663-059b-44fd-b9ab-5b9887d6e948', // ch.51, wool
  'f59d3203-b600-4edb-b0a6-04fc0f49ec1d', // ch.60
  'd2903166-a85b-4701-9987-5700fd4b4fd3', // ch.65, braiding hair
  'cff20819-fd52-436d-912d-71180ee350d6', // ch.58/52/60, cloth
  '752a7a55-afce-4007-a21d-23bf76c6d272', // ch.53
  'b47d031c-19e2-469e-8497-1ec79ce96b02', // ch.31, bone
  'f05ae63f-f536-40d3-a320-1dce2d01069a', // ch.56, yarn
  'f63ea1e0-9135-42f8-9d81-782bb2a1e72a', // ch.52, yarn
  'b22345c2-fb21-4265-9c23-f6d7e556d86f', // ch.03
  '95431261-6b78-498d-b272-60191f9fc22b', // ch.11
  '5a9d3175-4d7a-48cd-8fca-665addd41630', // ch.11
];

async function run() {
  await client.connect();
  const { rows } = await client.query(
    'SELECT id, rule_id, pattern, whitelist FROM lookup_intent_rule WHERE id = ANY($1::uuid[])',
    [uuidsOfInterest]
  );
  for (const r of rows) {
    console.log(`\nUUID: ${r.id}`);
    console.log(`ruleId: ${r.rule_id || '(no rule_id)'}`);
    console.log(`whitelist: ${JSON.stringify(r.whitelist)}`);
    const pat = r.pattern || {};
    console.log(`anyOf: ${JSON.stringify((pat.anyOf||[]).slice(0,10))}`);
    console.log(`noneOf: ${JSON.stringify((pat.noneOf||[]).slice(0,10))}`);
    console.log(`required: ${JSON.stringify(pat.required||[])}`);
    console.log(`anyOfGroups: ${JSON.stringify((pat.anyOfGroups||[]).map(g=>g.slice(0,3)))}`);
  }
  await client.end();
}

run().catch(e => { console.error(e); process.exit(1); });
