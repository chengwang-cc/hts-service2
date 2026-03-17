#!/usr/bin/env ts-node
import 'tsconfig-paths/register';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { getRepositoryToken } from '@nestjs/typeorm';
import { HtsEntity } from '../src/core/entities/hts.entity';
import { Repository } from 'typeorm';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const repo = app.get<Repository<HtsEntity>>(getRepositoryToken(HtsEntity), { strict: false });
  const rows = await repo.createQueryBuilder('h')
    .where('h.htsNumber LIKE :prefix', { prefix: '6307.90%' })
    .limit(5)
    .getMany();
  console.log(`6307.90 entries: ${rows.length}`);
  rows.forEach(r => console.log(` ${r.htsNumber}: ${r.description?.slice(0, 60)} | embedding: ${r.embedding ? 'yes' : 'NO'}`));
  
  // Also check 5208.59
  const rows2 = await repo.createQueryBuilder('h')
    .where('h.htsNumber LIKE :prefix', { prefix: '5208.59%' })
    .limit(3)
    .getMany();
  console.log(`\n5208.59 entries: ${rows2.length}`);
  rows2.forEach(r => console.log(` ${r.htsNumber}: ${r.description?.slice(0, 60)} | embedding: ${r.embedding ? 'yes' : 'NO'}`));
  await app.close();
}
main().catch(e => { console.error(e); process.exit(1); });
