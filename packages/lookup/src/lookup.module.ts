import { DynamicModule, Module } from '@nestjs/common';
import { CoreModule } from '@hts/core';

@Module({})
export class LookupModule {
  static forRoot(): DynamicModule {
    return {
      module: LookupModule,
      imports: [CoreModule.forFeature()],
    };
  }
}
