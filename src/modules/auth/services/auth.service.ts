import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { UserEntity } from '../entities/user.entity';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>,
    private readonly jwtService: JwtService,
  ) {}

  async validateUser(email: string, password: string): Promise<any> {
    const user = await this.userRepository.findOne({
      where: { email },
      relations: ['roles', 'organization'],
    });

    if (user && (await bcrypt.compare(password, user.password))) {
      const { password, ...result } = user;
      return result;
    }

    return null;
  }

  async login(user: any) {
    const payload = {
      sub: user.id,
      email: user.email,
      organizationId: user.organizationId,
      roles: user.roles?.map((r) => r.name) || [],
    };

    return {
      user,
      tokens: {
        accessToken: this.jwtService.sign(payload, { expiresIn: '1h' }),
        refreshToken: this.jwtService.sign(payload, { expiresIn: '7d' }), // 1 week
        expiresIn: 3600, // 1 hour in seconds
      },
    };
  }

  async refreshTokens(refreshToken: string) {
    try {
      // Verify the refresh token
      const payload = this.jwtService.verify(refreshToken);

      // Get fresh user data
      const user = await this.userRepository.findOne({
        where: { id: payload.sub },
        relations: ['roles', 'organization'],
      });

      if (!user || !user.isActive) {
        throw new Error('User not found or inactive');
      }

      // Generate new tokens
      const newPayload = {
        sub: user.id,
        email: user.email,
        organizationId: user.organizationId,
        roles: user.roles?.map((r) => r.name) || [],
      };

      return {
        user,
        tokens: {
          accessToken: this.jwtService.sign(newPayload, { expiresIn: '1h' }),
          refreshToken: this.jwtService.sign(newPayload, { expiresIn: '7d' }),
          expiresIn: 3600,
        },
      };
    } catch (error) {
      throw new Error('Invalid or expired refresh token');
    }
  }

  async register(
    email: string,
    password: string,
    firstName: string,
    lastName: string,
    organizationId: string | null,
  ) {
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = this.userRepository.create({
      email,
      password: hashedPassword,
      firstName,
      lastName,
      organizationId: organizationId || undefined,
    });

    return this.userRepository.save(user);
  }
}
