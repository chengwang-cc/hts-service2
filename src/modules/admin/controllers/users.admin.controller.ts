/**
 * Users Admin Controller
 * REST API endpoints for user management
 */

import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../guards/admin.guard';
import { UsersAdminService } from '../services/users.admin.service';
import { CreateUserDto } from '../dto/create-user.dto';
import { UpdateUserDto } from '../dto/update-user.dto';

@ApiTags('Admin - Users')
@ApiBearerAuth()
@Controller('admin/users')
@UseGuards(JwtAuthGuard, AdminGuard)
export class UsersAdminController {
  constructor(private readonly usersAdminService: UsersAdminService) {}

  /**
   * GET /admin/users
   * List all users with pagination
   */
  @Get()
  @ApiOperation({ summary: 'List all users' })
  async findAll(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('search') search?: string,
  ) {
    const pageNum = page ? parseInt(page, 10) : 1;
    const size = pageSize ? parseInt(pageSize, 10) : 20;

    const { users, total } = await this.usersAdminService.findAll(pageNum, size, search);

    return {
      success: true,
      data: users.map(user => ({
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        isActive: user.isActive,
        emailVerified: user.emailVerified,
        lastLoginAt: user.lastLoginAt,
        organizationId: user.organizationId,
        organization: user.organization ? {
          id: user.organization.id,
          name: user.organization.name,
        } : null,
        role: user.roles?.[0] ? {
          id: user.roles[0].id,
          name: user.roles[0].name,
          description: user.roles[0].description,
        } : null,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      })),
      meta: {
        total,
        page: pageNum,
        pageSize: size,
        totalPages: Math.ceil(total / size),
      },
    };
  }

  /**
   * GET /admin/users/:id
   * Get single user by ID
   */
  @Get(':id')
  @ApiOperation({ summary: 'Get user by ID' })
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    const user = await this.usersAdminService.findOne(id);

    return {
      success: true,
      data: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        isActive: user.isActive,
        emailVerified: user.emailVerified,
        lastLoginAt: user.lastLoginAt,
        organizationId: user.organizationId,
        organization: user.organization ? {
          id: user.organization.id,
          name: user.organization.name,
        } : null,
        roles: user.roles?.map(role => ({
          id: role.id,
          name: role.name,
          description: role.description,
        })) || [],
        metadata: user.metadata,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
    };
  }

  /**
   * POST /admin/users
   * Create new user
   */
  @Post()
  @ApiOperation({ summary: 'Create new user' })
  async create(@Body() createUserDto: CreateUserDto) {
    const user = await this.usersAdminService.create(createUserDto);

    return {
      success: true,
      data: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
      },
      message: 'User created successfully',
    };
  }

  /**
   * PATCH /admin/users/:id
   * Update existing user
   */
  @Patch(':id')
  @ApiOperation({ summary: 'Update user' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateUserDto: UpdateUserDto,
  ) {
    const user = await this.usersAdminService.update(id, updateUserDto);

    return {
      success: true,
      data: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        isActive: user.isActive,
      },
      message: 'User updated successfully',
    };
  }

  /**
   * DELETE /admin/users/:id
   * Delete user
   */
  @Delete(':id')
  @ApiOperation({ summary: 'Delete user' })
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    await this.usersAdminService.remove(id);

    return {
      success: true,
      message: 'User deleted successfully',
    };
  }

  /**
   * PATCH /admin/users/:id/reset-password
   * Reset user password
   */
  @Patch(':id/reset-password')
  @ApiOperation({ summary: 'Reset user password' })
  async resetPassword(
    @Param('id', ParseUUIDPipe) id: string,
    @Body('newPassword') newPassword: string,
  ) {
    await this.usersAdminService.resetPassword(id, newPassword);

    return {
      success: true,
      message: 'Password reset successfully',
    };
  }

  /**
   * PATCH /admin/users/:id/toggle-status
   * Toggle user active status
   */
  @Patch(':id/toggle-status')
  @ApiOperation({ summary: 'Toggle user status' })
  async toggleStatus(@Param('id', ParseUUIDPipe) id: string) {
    const user = await this.usersAdminService.toggleStatus(id);

    return {
      success: true,
      data: {
        id: user.id,
        isActive: user.isActive,
      },
      message: 'User status updated successfully',
    };
  }
}
