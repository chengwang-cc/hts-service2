import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { DataTransformerController } from './controllers/data-transformer.controller';
import {
  DataTransformerMappingEntity,
  DataTransformerProfileEntity,
  DataTransformerRunEntity,
  DataTransformerRunIssueEntity,
} from './entities';
import { DataTransformerService } from './services/data-transformer.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      DataTransformerProfileEntity,
      DataTransformerMappingEntity,
      DataTransformerRunEntity,
      DataTransformerRunIssueEntity,
    ]),
    AuthModule,
  ],
  controllers: [DataTransformerController],
  providers: [DataTransformerService],
  exports: [DataTransformerService],
})
export class DataTransformerModule {}
