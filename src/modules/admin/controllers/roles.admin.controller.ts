/**
 * Roles Admin Controller
 * REST API endpoints for role and permission management
 */

import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../guards/admin.guard';
import { RolesAdminService } from '../services/roles.admin.service';
import { CreateRoleDto } from '../dto/create-role.dto';
import { UpdateRoleDto } from '../dto/update-role.dto';

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

  /**
   * GET /admin/roles/:id
   * Get single role by ID
   */
  @Get(':id')
  @ApiOperation({ summary: 'Get role by ID' })
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    const { role, userCount } =
      await this.rolesAdminService.findOneWithUserCount(id);

    return {
      success: true,
      data: {
        id: role.id,
        name: role.name,
        description: role.description,
        permissions: role.permissions || [],
        isActive: role.isActive,
        userCount,
        createdAt: role.createdAt,
        updatedAt: role.updatedAt,
      },
    };
  }

  /**
   * POST /admin/roles
   * Create new role
   */
  @Post()
  @ApiOperation({ summary: 'Create new role' })
  async create(@Body() createRoleDto: CreateRoleDto) {
    const role = await this.rolesAdminService.create(createRoleDto);

    return {
      success: true,
      data: {
        id: role.id,
        name: role.name,
        description: role.description,
        permissions: role.permissions,
      },
      message: 'Role created successfully',
    };
  }

  /**
   * PATCH /admin/roles/:id
   * Update existing role
   */
  @Patch(':id')
  @ApiOperation({ summary: 'Update role' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateRoleDto: UpdateRoleDto,
  ) {
    const role = await this.rolesAdminService.update(id, updateRoleDto);

    return {
      success: true,
      data: {
        id: role.id,
        name: role.name,
        description: role.description,
        permissions: role.permissions,
        isActive: role.isActive,
      },
      message: 'Role updated successfully',
    };
  }

  /**
   * DELETE /admin/roles/:id
   * Delete role
   */
  @Delete(':id')
  @ApiOperation({ summary: 'Delete role' })
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    await this.rolesAdminService.remove(id);

    return {
      success: true,
      message: 'Role deleted successfully',
    };
  }
}
