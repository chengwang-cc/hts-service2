import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WidgetConfigEntity } from './entities/widget-config.entity';
import { WidgetSessionEntity } from './entities/widget-session.entity';
import { CheckoutOrderEntity } from './entities/checkout-order.entity';
import { ShopifySessionEntity } from '../shopify-app/entities/shopify-session.entity';
import { WidgetService } from './services/widget.service';
import { WidgetController } from './controllers/widget.controller';
import { WidgetApiController } from './controllers/widget-api.controller';
import { WidgetKeyGuard } from './guards/widget-key.guard';
import { CalculatorModule } from '../calculator/calculator.module';
import { ShopifyAppModule } from '../shopify-app/shopify-app.module';
import { ConnectorsModule } from '../connectors/connectors.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      WidgetConfigEntity,
      WidgetSessionEntity,
      CheckoutOrderEntity,
      ShopifySessionEntity,
    ]),
    CalculatorModule,
    forwardRef(() => ShopifyAppModule),
    ConnectorsModule,
  ],
  controllers: [WidgetController, WidgetApiController],
  providers: [WidgetService, WidgetKeyGuard],
  exports: [WidgetService],
})
export class WidgetModule {}
