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

function htsMatch(a, b) {
  return a.replace(/\D/g,'').slice(0,8) === b.replace(/\D/g,'').slice(0,8);
}

// Cluster misses by 4-digit prefix, find biggest cross-chapter misses
const crossChapterMisses = [];
const BATCH = 15;
const sleep = ms => new Promise(r => setTimeout(r, ms));

for (let i = 0; i < lines.length; i += BATCH) {
  const batch = lines.slice(i, i + BATCH);
  await Promise.all(batch.map(async e => {
    try {
      const resp = await fetch(`${API}/autocomplete?q=${encodeURIComponent(e.query)}&limit=10`);
      const data = await resp.json();
      const results = data.data || [];
      const hit = results.slice(0,10).some(r => htsMatch(r.htsNumber || '', e.expectedHtsNumber));
      if (!hit) {
        const got = results[0]?.htsNumber || 'none';
        const gotCh = got.replace(/\D/g,'').slice(0,2);
        const expCh = e.expectedHtsNumber.replace(/\D/g,'').slice(0,2);
        if (gotCh !== expCh) {
          crossChapterMisses.push({ q: e.query, exp: e.expectedHtsNumber, got });
        }
      }
    } catch(err) {}
  }));
  if (i % 200 === 0) await sleep(50);
}

// Group by expected chapter
const byChapter = {};
for (const m of crossChapterMisses) {
  const ch = m.exp.replace(/\D/g,'').slice(0,2);
  if (!byChapter[ch]) byChapter[ch] = [];
  byChapter[ch].push(m);
}

const sorted = Object.entries(byChapter).sort((a,b) => b[1].length - a[1].length);
console.log(`Total cross-chapter misses: ${crossChapterMisses.length}\n`);
for (const [ch, misses] of sorted.slice(0, 12)) {
  console.log(`\n=== Ch.${ch} (${misses.length} misses) exp prefix: ${misses[0].exp.slice(0,7)} ===`);
  for (const m of misses.slice(0, 5)) {
    console.log(`  "${m.q.slice(0,60)}" → got:${m.got.slice(0,12)} exp:${m.exp}`);
  }
}
