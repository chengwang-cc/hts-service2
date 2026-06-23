/**
 * Roles Admin Controller
 * REST API endpoints for role and permission management
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

@ApiTags('Admin - Roles')
@ApiBearerAuth()
@Controller('admin/roles')
@UseGuards(JwtAuthGuard, AdminGuard)
export class RolesAdminController {
  constructor(private readonly rolesAdminService: RolesAdminService) {}

  /**
   * GET /admin/roles
   * List all roles
   */
  @Get()
  @ApiOperation({ summary: 'List all roles' })
  async findAll() {
    const roles = await this.rolesAdminService.findAll();

    return {
      success: true,
      data: roles.map((role) => ({
        id: role.id,
        name: role.name,
        description: role.description,
        permissions: role.permissions || [],
        isActive: role.isActive,
        createdAt: role.createdAt,
        updatedAt: role.updatedAt,
      })),
    };
  }

}
