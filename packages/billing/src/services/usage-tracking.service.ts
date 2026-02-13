import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';
import { UsageRecordEntity } from '../entities/usage-record.entity';

@Injectable()
export class UsageTrackingService {
  constructor(
    @InjectRepository(UsageRecordEntity)
    private readonly usageRepo: Repository<UsageRecordEntity>,
  ) {}

  async trackUsage(
    organizationId: string,
    feature: string,
    quantity: number = 1,
    metadata?: Record<string, any>,
  ): Promise<UsageRecordEntity> {
    const record = this.usageRepo.create({
      organizationId,
      metricName: feature,
      quantity,
      metadata: metadata || null,
      timestamp: new Date(),
      subscriptionId: null,
      stripeUsageRecordId: null,
    });

    return this.usageRepo.save(record);
  }

  async getUsageSummary(
    organizationId: string,
    periodStart: Date,
    periodEnd: Date,
  ): Promise<Record<string, number>> {
    const records = await this.usageRepo.find({
      where: {
        organizationId,
        timestamp: Between(periodStart, periodEnd),
      },
    });

    const summary: Record<string, number> = {};

    records.forEach((record) => {
      if (!summary[record.metricName]) {
        summary[record.metricName] = 0;
      }
      summary[record.metricName] += record.quantity;
    });

    return summary;
  }

  async getCurrentUsage(organizationId: string): Promise<Record<string, number>> {
    // Get usage for current month
    const now = new Date();
    const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

    return this.getUsageSummary(organizationId, periodStart, periodEnd);
  }

  async getUsageRecords(
    organizationId: string,
    feature?: string,
    limit: number = 100,
  ): Promise<UsageRecordEntity[]> {
    const where: any = { organizationId };
    if (feature) {
      where.metricName = feature;
    }

    return this.usageRepo.find({
      where,
      order: { timestamp: 'DESC' },
      take: limit,
    });
  }
}
