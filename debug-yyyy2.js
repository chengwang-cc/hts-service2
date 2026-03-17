const { Client } = require('pg');
const http = require('http');

function apiQuery(text) {
  return new Promise((res, rej) => {
    const body = JSON.stringify({ query: text, limit: 5 });
    const req = http.request({ hostname: 'localhost', port: 3100, path: '/lookup/autocomplete-by-text-hybrid', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, r => {
      let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch { res([]); } });
    });
    req.on('error', rej); req.write(body); req.end();
  });
}

async function main() {
  const queries = [
    '310x310mm Glass Build Surface | 3D Printer Glass Bed | Smooth Borosilicate Glass',
    'High-Density Polyethylene (HDPE) Plastic Block, 2" x 6" x 6"',
  ];
  
  for (const q of queries) {
    const results = await apiQuery(q);
    console.log(`"${q.slice(0,60)}":`);
    for (const r of results.slice(0,5)) {
      console.log(`  ${r.htsNumber} ${r.description?.slice(0,60)}`);
    }
    console.log();
  }
}

main().catch(console.error);
