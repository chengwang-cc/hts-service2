import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IdempotencyKeyEntity } from './entities/idempotency-key.entity';
import { IdempotencyService } from './services/idempotency.service';
import { IdempotencyInterceptor } from './interceptors/idempotency.interceptor';

/**
 * Global module: every controller can apply `@Idempotent('scope')` +
 * `@UseInterceptors(IdempotencyInterceptor)` without re-importing this
 * module. Marked @Global so the interceptor's DI chain resolves
 * regardless of which module the consuming controller lives in.
 */
@Global()
@Module({
  imports: [TypeOrmModule.forFeature([IdempotencyKeyEntity])],
  providers: [IdempotencyService, IdempotencyInterceptor],
  exports: [IdempotencyService, IdempotencyInterceptor],
})
export class IdempotencyModule {}
