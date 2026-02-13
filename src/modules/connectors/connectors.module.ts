import { Module } from '@nestjs/common';
import { ConnectorsModule as ConnectorsPackageModule } from '@hts/connectors';
import { ConnectorsController } from './controllers/connectors.controller';

@Module({
  imports: [ConnectorsPackageModule],
  controllers: [ConnectorsController],
})
export class ConnectorsModule {}
