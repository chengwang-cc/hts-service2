/**
 * Analytics Admin Controller
 * REST API endpoints for system analytics and metrics
 */

import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../guards/admin.guard';
import { AnalyticsAdminService } from '../services/analytics.admin.service';

@ApiTags('Admin - Analytics')
@ApiBearerAuth()
@Controller('admin/analytics')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AnalyticsAdminController {
  constructor(private readonly analyticsAdminService: AnalyticsAdminService) {}

  /**
   * GET /admin/analytics/metrics
   * Get comprehensive system metrics
   */
  @Get('metrics')
  @ApiOperation({ summary: 'Get system metrics' })
  async getMetrics() {
    const metrics = await this.analyticsAdminService.getMetrics();

    return {
      success: true,
      data: metrics,
    };
  }

  /**
   * GET /admin/analytics/users
   * Get user statistics
   */
  @Get('users')
  @ApiOperation({ summary: 'Get user statistics' })
  async getUserStats() {
    const stats = await this.analyticsAdminService.getUserStats();

    return {
      success: true,
      data: stats,
    };
  }

  /**
   * GET /admin/analytics/organizations
   * Get organization statistics
   */
  @Get('organizations')
  @ApiOperation({ summary: 'Get organization statistics' })
  async getOrganizationStats() {
    const stats = await this.analyticsAdminService.getOrganizationStats();

    return {
      success: true,
      data: stats,
    };
  }

  /**
   * GET /admin/analytics/activity
   * Get recent activity (last 30 days)
   */
  @Get('activity')
  @ApiOperation({ summary: 'Get recent activity' })
  async getRecentActivity() {
    const activity = await this.analyticsAdminService.getRecentActivity();

    return {
      success: true,
      data: activity,
    };
  }
}
