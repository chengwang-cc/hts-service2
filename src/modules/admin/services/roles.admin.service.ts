/**
 * Roles Admin Service
 * Business logic for role management in admin portal
 */

import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RoleEntity } from '../../auth/entities/role.entity';
import { UserEntity } from '../../auth/entities/user.entity';
import { CreateRoleDto } from '../dto/create-role.dto';
import { UpdateRoleDto } from '../dto/update-role.dto';

export interface PermissionNode {
  key: string;
  title: string;
  children?: PermissionNode[];
  isLeaf?: boolean;
}

@Injectable()
export class RolesAdminService {
  constructor(
    @InjectRepository(RoleEntity)
    private roleRepository: Repository<RoleEntity>,
    @InjectRepository(UserEntity)
    private userRepository: Repository<UserEntity>,
  ) {}

  /**
   * Get all roles
   */
  async findAll(): Promise<RoleEntity[]> {
    return await this.roleRepository.find({
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Get single role by ID
   */
  async findOne(id: string): Promise<RoleEntity> {
    const role = await this.roleRepository.findOne({
      where: { id },
    });

    if (!role) {
      throw new NotFoundException(`Role with ID ${id} not found`);
    }

    return role;
  }

  /**
   * Get role with user count
   */
  async findOneWithUserCount(id: string): Promise<{ role: RoleEntity; userCount: number }> {
    const role = await this.findOne(id);

    const userCount = await this.userRepository
      .createQueryBuilder('user')
      .innerJoin('user.roles', 'role')
      .where('role.id = :roleId', { roleId: id })
      .getCount();

    return { role, userCount };
  }

  /**
   * Create new role
   */
  async create(createRoleDto: CreateRoleDto): Promise<RoleEntity> {
    // Check if role name already exists
    const existing = await this.roleRepository.findOne({
      where: { name: createRoleDto.name },
    });

    if (existing) {
      throw new ConflictException('Role name already exists');
    }

    const role = this.roleRepository.create({
      name: createRoleDto.name,
      description: createRoleDto.description,
      permissions: createRoleDto.permissions || [],
    });

    return await this.roleRepository.save(role);
  }

  /**
   * Update existing role
   */
  async update(id: string, updateRoleDto: UpdateRoleDto): Promise<RoleEntity> {
    const role = await this.findOne(id);

    // Update name if provided and different
    if (updateRoleDto.name && updateRoleDto.name !== role.name) {
      const existing = await this.roleRepository.findOne({
        where: { name: updateRoleDto.name },
      });

      if (existing) {
        throw new ConflictException('Role name already exists');
      }

      role.name = updateRoleDto.name;
    }

    // Update other fields
    if (updateRoleDto.description !== undefined) {
      role.description = updateRoleDto.description;
    }

    if (updateRoleDto.permissions !== undefined) {
      role.permissions = updateRoleDto.permissions;
    }

    if (updateRoleDto.isActive !== undefined) {
      role.isActive = updateRoleDto.isActive;
    }

    return await this.roleRepository.save(role);
  }

  /**
   * Delete role
   */
  async remove(id: string): Promise<void> {
    const { role, userCount } = await this.findOneWithUserCount(id);

    if (userCount > 0) {
      throw new BadRequestException(
        `Cannot delete role. ${userCount} user(s) are assigned to this role.`,
      );
    }

    await this.roleRepository.remove(role);
  }

  /**
   * Get permission tree structure
   */
  getPermissionTree(): PermissionNode[] {
    return [
      {
        key: 'hts',
        title: 'HTS Management',
        children: [
          { key: 'hts:lookup', title: 'Lookup HTS Codes', isLeaf: true },
          { key: 'hts:search', title: 'Search HTS Codes', isLeaf: true },
          { key: 'hts:calculate', title: 'Calculate Duties', isLeaf: true },
          { key: 'hts:import', title: 'Import HTS Data', isLeaf: true },
        ],
      },
      {
        key: 'kb',
        title: 'Knowledge Base',
        children: [
          { key: 'kb:query', title: 'Query Knowledge Base', isLeaf: true },
          { key: 'kb:recommend', title: 'Get Recommendations', isLeaf: true },
          { key: 'kb:manage', title: 'Manage Knowledge Base', isLeaf: true },
        ],
      },
      {
        key: 'admin',
        title: 'Administration',
        children: [
          { key: 'admin:users', title: 'Manage Users', isLeaf: true },
          { key: 'admin:roles', title: 'Manage Roles', isLeaf: true },
          { key: 'admin:organizations', title: 'Manage Organizations', isLeaf: true },
          { key: 'admin:settings', title: 'System Settings', isLeaf: true },
          { key: 'admin:analytics', title: 'View Analytics', isLeaf: true },
        ],
      },
      {
        key: 'formula',
        title: 'Formula Management',
        children: [
          { key: 'formula:view', title: 'View Formulas', isLeaf: true },
          { key: 'formula:generate', title: 'Generate Formulas', isLeaf: true },
          { key: 'formula:approve', title: 'Approve Formulas', isLeaf: true },
          { key: 'formula:override', title: 'Override Formulas', isLeaf: true },
        ],
      },
      {
        key: 'test-case',
        title: 'Test Cases',
        children: [
          { key: 'test-case:view', title: 'View Test Cases', isLeaf: true },
          { key: 'test-case:manage', title: 'Manage Test Cases', isLeaf: true },
          { key: 'test-case:run', title: 'Run Tests', isLeaf: true },
        ],
      },
    ];
  }
}
