/**
 * P4.3 — Admin CRUD for jurisdiction tax / fee / low-value rules.
 */

import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../guards/admin.guard';
import { AdminPermissionsGuard } from '../guards/admin-permissions.guard';
import { AdminPermissions } from '../decorators/admin-permissions.decorator';
import {
  FeeRuleEntity,
  LowValueRuleEntity,
  TaxRuleEntity,
} from '../../jurisdiction/entities';

@ApiTags('Admin - Jurisdiction Rules')
@ApiBearerAuth()
@Controller('admin/jurisdictions/:code/rules')
@UseGuards(JwtAuthGuard, AdminGuard)
export class JurisdictionRulesAdminController {
  constructor(
    @InjectRepository(TaxRuleEntity)
    private readonly taxRepo: Repository<TaxRuleEntity>,
    @InjectRepository(FeeRuleEntity)
    private readonly feeRepo: Repository<FeeRuleEntity>,
    @InjectRepository(LowValueRuleEntity)
    private readonly lvRepo: Repository<LowValueRuleEntity>,
  ) {}

  // ── Tax Rules ──────────────────────────────────────────────────────────

  @Get('tax')
  async listTax(@Param('code') code: string) {
    const rows = await this.taxRepo.find({
      where: { jurisdictionCode: code.toUpperCase() },
      order: { effectiveFrom: 'DESC' },
    });
    return { count: rows.length, data: rows };
  }

  @Post('tax')
  @UseGuards(AdminPermissionsGuard)
  @AdminPermissions('admin.jurisdiction.rules.write')
  async createTax(
    @Param('code') code: string,
    @Body() body: Partial<TaxRuleEntity>,
  ) {
    const row = this.taxRepo.create({
      ...body,
      jurisdictionCode: code.toUpperCase(),
    });
    return this.taxRepo.save(row);
  }

  @Patch('tax/:id')
  @UseGuards(AdminPermissionsGuard)
  @AdminPermissions('admin.jurisdiction.rules.write')
  async updateTax(
    @Param('id') id: string,
    @Body() body: Partial<TaxRuleEntity>,
  ) {
    const row = await this.taxRepo.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Tax rule not found');
    Object.assign(row, body);
    return this.taxRepo.save(row);
  }

  @Delete('tax/:id')
  @UseGuards(AdminPermissionsGuard)
  @AdminPermissions('admin.jurisdiction.rules.write')
  async deleteTax(@Param('id') id: string) {
    const res = await this.taxRepo.delete(id);
    return { deleted: res.affected ?? 0 };
  }

  // ── Fee Rules ──────────────────────────────────────────────────────────

  @Get('fee')
  async listFee(@Param('code') code: string) {
    const rows = await this.feeRepo.find({
      where: { jurisdictionCode: code.toUpperCase() },
      order: { effectiveFrom: 'DESC' },
    });
    return { count: rows.length, data: rows };
  }

  @Post('fee')
  @UseGuards(AdminPermissionsGuard)
  @AdminPermissions('admin.jurisdiction.rules.write')
  async createFee(
    @Param('code') code: string,
    @Body() body: Partial<FeeRuleEntity>,
  ) {
    const row = this.feeRepo.create({
      ...body,
      jurisdictionCode: code.toUpperCase(),
    });
    return this.feeRepo.save(row);
  }

  @Patch('fee/:id')
  @UseGuards(AdminPermissionsGuard)
  @AdminPermissions('admin.jurisdiction.rules.write')
  async updateFee(
    @Param('id') id: string,
    @Body() body: Partial<FeeRuleEntity>,
  ) {
    const row = await this.feeRepo.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Fee rule not found');
    Object.assign(row, body);
    return this.feeRepo.save(row);
  }

  @Delete('fee/:id')
  @UseGuards(AdminPermissionsGuard)
  @AdminPermissions('admin.jurisdiction.rules.write')
  async deleteFee(@Param('id') id: string) {
    const res = await this.feeRepo.delete(id);
    return { deleted: res.affected ?? 0 };
  }

  // ── Low-Value Rules ────────────────────────────────────────────────────

  @Get('low-value')
  async listLv(@Param('code') code: string) {
    const rows = await this.lvRepo.find({
      where: { jurisdictionCode: code.toUpperCase() },
      order: { effectiveFrom: 'DESC' },
    });
    return { count: rows.length, data: rows };
  }

  @Post('low-value')
  @UseGuards(AdminPermissionsGuard)
  @AdminPermissions('admin.jurisdiction.rules.write')
  async createLv(
    @Param('code') code: string,
    @Body() body: Partial<LowValueRuleEntity>,
  ) {
    const row = this.lvRepo.create({
      ...body,
      jurisdictionCode: code.toUpperCase(),
    });
    return this.lvRepo.save(row);
  }

  @Patch('low-value/:id')
  @UseGuards(AdminPermissionsGuard)
  @AdminPermissions('admin.jurisdiction.rules.write')
  async updateLv(
    @Param('id') id: string,
    @Body() body: Partial<LowValueRuleEntity>,
  ) {
    const row = await this.lvRepo.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Low-value rule not found');
    Object.assign(row, body);
    return this.lvRepo.save(row);
  }

  @Delete('low-value/:id')
  @UseGuards(AdminPermissionsGuard)
  @AdminPermissions('admin.jurisdiction.rules.write')
  async deleteLv(@Param('id') id: string) {
    const res = await this.lvRepo.delete(id);
    return { deleted: res.affected ?? 0 };
  }

  // ── Effective-at lookup (read-only) ────────────────────────────────────

  @Get('effective')
  async effective(
    @Param('code') code: string,
    @Query('date') date?: string,
  ) {
    const d = date || new Date().toISOString().slice(0, 10);
    const [tax, fee, lv] = await Promise.all([
      this.taxRepo
        .createQueryBuilder('t')
        .where('t.jurisdictionCode = :code', { code: code.toUpperCase() })
        .andWhere('t.effectiveFrom <= :d', { d })
        .andWhere('(t.effectiveTo IS NULL OR t.effectiveTo >= :d)', { d })
        .getMany(),
      this.feeRepo
        .createQueryBuilder('f')
        .where('f.jurisdictionCode = :code', { code: code.toUpperCase() })
        .andWhere('f.effectiveFrom <= :d', { d })
        .andWhere('(f.effectiveTo IS NULL OR f.effectiveTo >= :d)', { d })
        .getMany(),
      this.lvRepo
        .createQueryBuilder('l')
        .where('l.jurisdictionCode = :code', { code: code.toUpperCase() })
        .andWhere('l.effectiveFrom <= :d', { d })
        .andWhere('(l.effectiveTo IS NULL OR l.effectiveTo >= :d)', { d })
        .getMany(),
    ]);
    return { code: code.toUpperCase(), effectiveDate: d, taxRules: tax, feeRules: fee, lowValueRules: lv };
  }
}
