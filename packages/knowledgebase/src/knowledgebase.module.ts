import { DynamicModule, Module } from '@nestjs/common';
import { CoreModule } from '@hts/core';

@Module({})
export class KnowledgebaseModule {
  static forRoot(): DynamicModule {
    return {
      module: KnowledgebaseModule,
      imports: [CoreModule.forFeature()],
    };
  }
}
