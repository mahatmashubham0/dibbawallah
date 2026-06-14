import { Module } from '@nestjs/common';
import { DeliveriesService } from './deliveries.service';
import { DeliveriesController } from './deliveries.controller';
import { DeliveryGeneratorProcessorService } from './processors/delivery-generator.processor';
import { PrismaModule } from '../prisma';
import { WalletModule } from '../wallet/wallet.module';

@Module({
  imports: [PrismaModule, WalletModule],
  controllers: [DeliveriesController],
  providers: [DeliveriesService, DeliveryGeneratorProcessorService],
  exports: [DeliveriesService],
})
export class DeliveriesModule {}
