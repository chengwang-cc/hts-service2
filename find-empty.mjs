import { createReadStream } from 'fs';
import { createInterface } from 'readline';

const DATASET = '/Users/cheng/projects/cc/hts/hts-service/docs/evaluation/lookup-evaluation-set-v1.jsonl';
const API = 'http://localhost:3111/api/v1/lookup';

const lines = [];
const rl = createInterface({ input: createReadStream(DATASET) });
for await (const line of rl) {
  if (line.startsWith('#') || !line.trim()) continue;
  const e = JSON.parse(line);
  if (e.source === 'chit-chats-csv' && e.expectedHtsNumber) lines.push(e);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const BATCH = 20;
const empties = [];

for (let i = 0; i < lines.length; i += BATCH) {
  const batch = lines.slice(i, i + BATCH);
  await Promise.all(batch.map(async e => {
    try {
      const resp = await fetch(`${API}/autocomplete?q=${encodeURIComponent(e.query)}&limit=10`);
      const data = await resp.json();
      const results = data.data || [];
      if (results.length === 0) {
        empties.push({ q: e.query, exp: e.expectedHtsNumber });
      }
    } catch(err) {}
  }));
  if (i % 300 === 0) await sleep(50);
}

console.log(`Empty results (${empties.length}):`);
for (const e of empties) {
  console.log(`  "${e.q}" → expected:${e.exp}`);
}
