import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { EcommerceHandoffController } from './controllers/ecommerce-handoff.controller';
import { EcommerceHandoffEntity } from './entities/ecommerce-handoff.entity';
import { EcommerceHandoffService } from './services/ecommerce-handoff.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([EcommerceHandoffEntity]),
    AuthModule,
    AuditModule,
  ],
  controllers: [EcommerceHandoffController],
  providers: [EcommerceHandoffService],
  exports: [EcommerceHandoffService],
})
export class EcommerceHandoffModule {}
