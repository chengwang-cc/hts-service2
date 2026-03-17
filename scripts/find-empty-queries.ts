#!/usr/bin/env ts-node
import 'tsconfig-paths/register';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { LookupService } from '../src/modules/lookup/services/lookup.service';
import * as fs from 'fs';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const svc = app.get(LookupService, { strict: false });
  const data = fs.readFileSync('/Users/cheng/projects/cc/hts/hts-service/docs/evaluation/lookup-evaluation-set-v1.jsonl', 'utf8');
  const entries = data.split('\n').filter(l => l.trim()).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(e => e && e.source === 'chit-chats-csv');
  const empty: string[] = [];
  for (const e of entries) {
    try {
      const r = await (svc as any).autocompleteByTextHybrid(e.query, { limit: 10 });
      if (!r || r.length === 0) empty.push(e.query);
    } catch {}
  }
  console.log(`Empty: ${empty.length}`);
  empty.forEach(q => console.log(`  "${q}"`));
  await app.close();
}
main().catch(e => { console.error(e); process.exit(1); });
