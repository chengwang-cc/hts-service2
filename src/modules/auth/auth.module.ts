import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { UserEntity, RoleEntity, OrganizationEntity } from './entities';
import { AuthService } from './services/auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { GoogleStrategy } from './strategies/google.strategy';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { GoogleAuthGuard } from './guards/google-auth.guard';
import { GoogleAuthCallbackGuard } from './guards/google-auth-callback.guard';
import { AuthController } from './controllers/auth.controller';

const userTypeOrmModule = TypeOrmModule.forFeature([
  UserEntity,
  RoleEntity,
  OrganizationEntity,
]);

@Module({
  imports: [
    userTypeOrmModule,
    PassportModule,
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'your-secret-key',
      signOptions: { expiresIn: '1h' },
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtStrategy,
    GoogleStrategy,
    JwtAuthGuard,
    GoogleAuthGuard,
    GoogleAuthCallbackGuard,
  ],
  exports: [
    AuthService,
    JwtStrategy,
    JwtAuthGuard,
    PassportModule,
    JwtModule,
    userTypeOrmModule,
  ],
})
export class AuthModule {}
