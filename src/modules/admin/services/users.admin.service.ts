/**
 * Users Admin Service
 * Business logic for user management in admin portal
 */

import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { UserEntity } from '../../auth/entities/user.entity';
import { RoleEntity } from '../../auth/entities/role.entity';
import { CreateUserDto } from '../dto/create-user.dto';
import { UpdateUserDto } from '../dto/update-user.dto';
import * as bcrypt from 'bcryptjs';

@Injectable()
export class UsersAdminService {
  constructor(
    @InjectRepository(UserEntity)
    private userRepository: Repository<UserEntity>,
    @InjectRepository(RoleEntity)
    private roleRepository: Repository<RoleEntity>,
  ) {}

  /**
   * Get all users with pagination and search
   */
  async findAll(
    page: number = 1,
    pageSize: number = 20,
    search?: string,
  ): Promise<{ users: UserEntity[]; total: number }> {
    const query = this.userRepository
      .createQueryBuilder('user')
      .leftJoinAndSelect('user.roles', 'roles')
      .leftJoinAndSelect('user.organization', 'organization');

    if (search) {
      query.where(
        'user.email ILIKE :search OR user.firstName ILIKE :search OR user.lastName ILIKE :search',
        { search: `%${search}%` },
      );
    }

    const [users, total] = await query
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .orderBy('user.createdAt', 'DESC')
      .getManyAndCount();

    return { users, total };
  }

  /**
   * Get single user by ID
   */
  async findOne(id: string): Promise<UserEntity> {
    const user = await this.userRepository.findOne({
      where: { id },
      relations: ['roles', 'organization'],
    });

    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }

    return user;
  }

  /**
   * Create new user
   */
  async create(createUserDto: CreateUserDto): Promise<UserEntity> {
    // Check if email already exists
    const existing = await this.userRepository.findOne({
      where: { email: createUserDto.email },
    });

    if (existing) {
      throw new ConflictException('Email already exists');
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(createUserDto.password, 10);

    // Load roles if provided
    let roles: RoleEntity[] = [];
    if (createUserDto.roleIds && createUserDto.roleIds.length > 0) {
      roles = await this.roleRepository.find({
        where: { id: In(createUserDto.roleIds) },
      });

      if (roles.length !== createUserDto.roleIds.length) {
        throw new BadRequestException('One or more role IDs are invalid');
      }
    }

    // Create user
    const user = this.userRepository.create({
      email: createUserDto.email,
      password: hashedPassword,
      firstName: createUserDto.firstName,
      lastName: createUserDto.lastName,
      organizationId: createUserDto.organizationId,
      roles,
    });

    return await this.userRepository.save(user);
  }

  /**
   * Update existing user
   */
  async update(id: string, updateUserDto: UpdateUserDto): Promise<UserEntity> {
    const user = await this.findOne(id);

    // Update email if provided and different
    if (updateUserDto.email && updateUserDto.email !== user.email) {
      const existing = await this.userRepository.findOne({
        where: { email: updateUserDto.email },
      });

      if (existing) {
        throw new ConflictException('Email already exists');
      }

      user.email = updateUserDto.email;
    }

    // Update password if provided
    if (updateUserDto.password) {
      user.password = await bcrypt.hash(updateUserDto.password, 10);
    }

    // Update other fields
    if (updateUserDto.firstName !== undefined) {
      user.firstName = updateUserDto.firstName;
    }

    if (updateUserDto.lastName !== undefined) {
      user.lastName = updateUserDto.lastName;
    }

    if (updateUserDto.organizationId !== undefined) {
      user.organizationId = updateUserDto.organizationId;
    }

    if (updateUserDto.isActive !== undefined) {
      user.isActive = updateUserDto.isActive;
    }

    // Update roles if provided
    if (updateUserDto.roleIds !== undefined) {
      if (updateUserDto.roleIds.length > 0) {
        user.roles = await this.roleRepository.find({
          where: { id: In(updateUserDto.roleIds) },
        });

        if (user.roles.length !== updateUserDto.roleIds.length) {
          throw new BadRequestException('One or more role IDs are invalid');
        }
      } else {
        user.roles = [];
      }
    }

    return await this.userRepository.save(user);
  }

  /**
   * Delete user
   */
  async remove(id: string): Promise<void> {
    const user = await this.findOne(id);
    await this.userRepository.remove(user);
  }

  /**
   * Reset user password
   */
  async resetPassword(id: string, newPassword: string): Promise<UserEntity> {
    const user = await this.findOne(id);
    user.password = await bcrypt.hash(newPassword, 10);
    return await this.userRepository.save(user);
  }

  /**
   * Toggle user active status
   */
  async toggleStatus(id: string): Promise<UserEntity> {
    const user = await this.findOne(id);
    user.isActive = !user.isActive;
    return await this.userRepository.save(user);
  }
}
