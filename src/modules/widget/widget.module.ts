import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WidgetConfigEntity } from './entities/widget-config.entity';
import { WidgetSessionEntity } from './entities/widget-session.entity';
import { WidgetService } from './services/widget.service';
import { WidgetController } from './controllers/widget.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([WidgetConfigEntity, WidgetSessionEntity]),
  ],
  controllers: [WidgetController],
  providers: [WidgetService],
  exports: [WidgetService],
})
export class WidgetModule {}
