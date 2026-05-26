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
import { RegisterRateLimitGuard } from './guards/register-rate-limit.guard';
import { AuthController } from './controllers/auth.controller';
import { ApiKeysModule } from '../api-keys/api-keys.module';
import { BillingModule } from '../billing/billing.module';

const userTypeOrmModule = TypeOrmModule.forFeature([
  UserEntity,
  RoleEntity,
  OrganizationEntity,
]);

// H8 fix (2026-05-27): hard-fail boot in production if JWT_SECRET is
// missing. Default dev secret is preserved so local + test runs work,
// but a missing-in-prod JWT_SECRET is a security defect — fail loud.
function resolveJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (secret && secret.length > 0) return secret;
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'JWT_SECRET is required in production. Set it via a k8s Secret + envFrom.',
    );
  }
  return 'your-secret-key';
}

@Module({
  imports: [
    userTypeOrmModule,
    PassportModule,
    JwtModule.register({
      secret: resolveJwtSecret(),
      signOptions: { expiresIn: '1h' },
    }),
    ApiKeysModule,
    BillingModule,
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtStrategy,
    GoogleStrategy,
    JwtAuthGuard,
    GoogleAuthGuard,
    GoogleAuthCallbackGuard,
    RegisterRateLimitGuard,
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
