import { DynamicModule, Module } from '@nestjs/common';
import { CoreModule } from '@hts/core';

@Module({})
export class CalculatorModule {
  static forRoot(): DynamicModule {
    return {
      module: CalculatorModule,
      imports: [CoreModule.forFeature()],
    };
  }
}
