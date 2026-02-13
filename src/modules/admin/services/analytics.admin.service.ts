/**
 * Analytics Admin Service
 * Provides system-wide analytics and metrics
 */

import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserEntity } from '../../auth/entities/user.entity';
import { OrganizationEntity } from '../../auth/entities/organization.entity';

export interface AnalyticsMetrics {
  totalApiCalls: number;
  totalUsers: number;
  totalClassifications: number;
  totalCalculations: number;
  formulaCoverage: number;
  testPassRate: number;
}

@Injectable()
export class AnalyticsAdminService {
  constructor(
    @InjectRepository(UserEntity)
    private userRepository: Repository<UserEntity>,
    @InjectRepository(OrganizationEntity)
    private organizationRepository: Repository<OrganizationEntity>,
  ) {}

  /**
   * Get comprehensive system metrics
   */
  async getMetrics(): Promise<AnalyticsMetrics> {
    // Get total users
    const totalUsers = await this.userRepository.count();

    // TODO: Get actual metrics from respective tables/services
    // For now, return placeholder values
    return {
      totalApiCalls: 0,
      totalUsers,
      totalClassifications: 0,
      totalCalculations: 0,
      formulaCoverage: 0,
      testPassRate: 0,
    };
  }

  /**
   * Get user statistics
   */
  async getUserStats() {
    const total = await this.userRepository.count();
    const active = await this.userRepository.count({ where: { isActive: true } });

    const byRole = await this.userRepository
      .createQueryBuilder('user')
      .leftJoin('user.roles', 'role')
      .select('role.name', 'roleName')
      .addSelect('COUNT(user.id)', 'count')
      .groupBy('role.name')
      .getRawMany();

    return {
      total,
      active,
      inactive: total - active,
      byRole,
    };
  }

  /**
   * Get organization statistics
   */
  async getOrganizationStats() {
    const total = await this.organizationRepository.count();
    const active = await this.organizationRepository.count({ where: { isActive: true } });

    const byPlan = await this.organizationRepository
      .createQueryBuilder('org')
      .select('org.plan', 'plan')
      .addSelect('COUNT(org.id)', 'count')
      .groupBy('org.plan')
      .getRawMany();

    return {
      total,
      active,
      inactive: total - active,
      byPlan,
    };
  }

  /**
   * Get recent activity (last 30 days)
   */
  async getRecentActivity() {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const newUsers = await this.userRepository
      .createQueryBuilder('user')
      .where('user.createdAt >= :date', { date: thirtyDaysAgo })
      .getCount();

    // TODO: Implement other activity metrics
    return {
      newUsers,
      testExecutions: 0,
      formulaUpdates: 0,
      classifications: 0,
    };
  }
}
