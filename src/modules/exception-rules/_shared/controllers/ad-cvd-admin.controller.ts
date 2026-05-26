import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import { JwtAuthGuard } from '../../../auth/guards/jwt-auth.guard';
import { AdCvdOrderEntity } from '../ad-cvd-orders.entity';
import { AdCvdImporterService } from '../ad-cvd-importer.service';
import { AdCvdLookupService } from '../ad-cvd-lookup.service';

/**
 * Admin endpoints for AD/CVD order data (Phase 9, P9.T2).
 *
 *   POST /admin/ad-cvd-orders/upload-csv   multipart CSV import
 *   POST /admin/ad-cvd-orders/dry-run-csv  validate without writing
 *   POST /admin/ad-cvd-orders/load-seed    one-shot bootstrap from the
 *                                          committed sample seed
 *   GET  /admin/ad-cvd-orders              ?destination=&origin=&hts=
 *   GET  /admin/ad-cvd-orders/lookup       single lookup by query params
 */
@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('admin/ad-cvd-orders')
export class AdCvdAdminController {
  constructor(
    @InjectRepository(AdCvdOrderEntity)
    private readonly repo: Repository<AdCvdOrderEntity>,
    private readonly importer: AdCvdImporterService,
    private readonly lookup: AdCvdLookupService,
  ) {}

  @Post('upload-csv')
  @ApiOperation({ summary: 'Bulk-upsert AD/CVD orders from a CSV upload.' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB — ~50k rows
    }),
  )
  async upload(
    @UploadedFile() file: { buffer: Buffer; mimetype: string; originalname: string; size: number },
    @Req() req: any,
  ) {
    if (!file) return { error: 'no file uploaded' };
    const actor = req?.user?.email ?? req?.user?.id ?? 'admin';
    const summary = await this.importer.loadCsv(file.buffer, `upload:${file.originalname}|by:${actor}`);
    return summary;
  }

  @Post('dry-run-csv')
  @ApiOperation({ summary: 'Validate a CSV upload without writing.' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }),
  )
  async dryRun(
    @UploadedFile() file: { buffer: Buffer; mimetype: string; originalname: string },
  ) {
    if (!file) return { error: 'no file uploaded' };
    return this.importer.dryRun(file.buffer);
  }

  @Post('load-seed')
  @ApiOperation({ summary: 'One-shot bootstrap from the committed sample seed.' })
  async loadSeed() {
    return this.importer.loadSeedFile();
  }

  @Get()
  @ApiOperation({ summary: 'List AD/CVD orders, optionally filtered.' })
  async list(
    @Query('destination') destination?: string,
    @Query('origin') origin?: string,
    @Query('hts') hts?: string,
    @Query('limit') limit?: string,
  ) {
    const qb = this.repo.createQueryBuilder('o');
    if (destination) qb.andWhere('o.destinationCountry = :d', { d: destination.toUpperCase() });
    if (origin) qb.andWhere('o.originCountry = :o', { o: origin.toUpperCase() });
    if (hts) qb.andWhere('o.htsCode LIKE :h', { h: `${hts.replace(/\./g, '')}%` });
    qb.orderBy('o.destinationCountry', 'ASC').addOrderBy('o.htsCode', 'ASC');
    qb.limit(Math.max(1, Math.min(500, Number(limit ?? 100))));
    return qb.getMany();
  }

  @Get('lookup')
  @ApiOperation({ summary: 'Single lookup by destination + hts + origin (+ exporter).' })
  async runLookup(
    @Query('destination') destination: string,
    @Query('hts') hts: string,
    @Query('origin') origin: string,
    @Query('exporter') exporter?: string,
  ) {
    return this.lookup.lookup({
      destinationCountry: destination,
      htsCode: hts,
      originCountry: origin,
      exporterName: exporter ?? null,
    });
  }
}
