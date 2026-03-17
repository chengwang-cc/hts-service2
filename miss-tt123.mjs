import { createReadStream } from 'fs';
import { createInterface } from 'readline';

const DATASET = '/Users/cheng/projects/cc/hts/hts-service/docs/evaluation/lookup-evaluation-set-v1.jsonl';
const API = 'http://localhost:3111/api/v1/lookup';

// Load eval entries
const lines = [];
const rl = createInterface({ input: createReadStream(DATASET) });
for await (const line of rl) {
  if (line.startsWith('#') || !line.trim()) continue;
  const e = JSON.parse(line);
  if (e.source === 'chit-chats-csv' && e.expectedHtsNumber) lines.push(e);
}

const targets = ['4202', '3926', '6307', '8205', '6912', '7117', '4421', '5810'];
const buckets = {};
for (const t of targets) buckets[t] = [];

function htsMatch(a, b) {
  return a.replace(/\D/g,'').slice(0,8) === b.replace(/\D/g,'').slice(0,8);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const BATCH = 10;

for (let i = 0; i < lines.length; i += BATCH) {
  const batch = lines.slice(i, i + BATCH);
  await Promise.all(batch.map(async e => {
    const expPrefix = e.expectedHtsNumber.replace(/\D/g,'').slice(0,4);
    if (!targets.includes(expPrefix)) return;
    try {
      const resp = await fetch(`${API}/autocomplete?q=${encodeURIComponent(e.query)}&limit=10`);
      const data = await resp.json();
      const results = data.data || [];
      const hit = results.slice(0,10).some(r => htsMatch(r.htsNumber || '', e.expectedHtsNumber));
      if (!hit) {
        const got = results[0]?.htsNumber || 'none';
        buckets[expPrefix].push({ q: e.query, exp: e.expectedHtsNumber, got });
      }
    } catch(err) {}
  }));
  if (i % 100 === 0) await sleep(50);
}

for (const t of targets) {
  const misses = buckets[t];
  if (!misses.length) continue;
  console.log(`\n=== ${t} (${misses.length} misses) ===`);
  for (const m of misses.slice(0, 10)) {
    console.log(`  "${m.q}" => got:${m.got.slice(0,14)} exp:${m.exp}`);
  }
}
