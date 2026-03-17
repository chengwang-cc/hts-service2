#!/usr/bin/env ts-node
import 'tsconfig-paths/register';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Injectable } from '@nestjs/common';

@Injectable()
class Checker {
  constructor(@InjectDataSource() private ds: DataSource) {}
  async run() {
    const r = await this.ds.query(`
      SELECT 
        to_tsquery('english', 'down:*') as "down",
        to_tsquery('english', 'pillow:*') as "pillow",
        to_tsquery('english', 'down:* & pillow:*') as "downpillow"
    `);
    console.log(r[0]);
    // Also check if any HTS entries have both down and pillow
    const r2 = await this.ds.query(`
      SELECT hts_number, description FROM hts WHERE search_vector @@ to_tsquery('english', 'down:* & pillow:*') LIMIT 5
    `);
    console.log('AND results:', r2.length, r2.slice(0,3));
    const r3 = await this.ds.query(`
      SELECT hts_number, description FROM hts WHERE search_vector @@ to_tsquery('english', 'down:* | pillow:*') ORDER BY ts_rank_cd(search_vector, to_tsquery('english', 'down:* | pillow:*')) DESC LIMIT 5
    `);
    console.log('OR results:', r3.length, r3.slice(0,5).map((x: any) => x.hts_number + ' ' + (x.description||'').slice(0,40)));
  }
}
