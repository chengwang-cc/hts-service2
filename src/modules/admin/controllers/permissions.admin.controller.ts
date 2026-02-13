/**
 * Permissions Admin Controller
 * REST API endpoints for permission management
 */

import {
  Controller,
  Get,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../guards/admin.guard';
import { RolesAdminService } from '../services/roles.admin.service';

@ApiTags('Admin - Permissions')
@ApiBearerAuth()
@Controller('admin/permissions')
@UseGuards(JwtAuthGuard, AdminGuard)
export class PermissionsAdminController {
  constructor(private readonly rolesAdminService: RolesAdminService) {}

  /**
   * GET /admin/permissions
   * Get permission tree structure
   */
  @Get()
  @ApiOperation({ summary: 'Get permission tree' })
  async getPermissionTree() {
    const tree = this.rolesAdminService.getPermissionTree();

    return {
      success: true,
      data: tree,
    };
  }
}
