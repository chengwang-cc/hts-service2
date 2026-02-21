import { Module } from '@nestjs/common';
import { TestController } from './test.controller';
import { LookupModule } from '../lookup/lookup.module';

@Module({
  imports: [LookupModule],
  controllers: [TestController],
})
export class TestModule {}
