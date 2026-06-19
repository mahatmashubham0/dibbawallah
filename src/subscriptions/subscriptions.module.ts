import { Module } from '@nestjs/common';
import { SubscriptionsService } from './subscriptions.service';
import { SubscriptionLogsService } from './subscription-logs.service';
import { SubscriptionsController } from './subscriptions.controller';
import { SubscriptionsPauseController } from './subscriptions-pause.controller';
import { SubscriptionsRefundController } from './subscriptions-refund.controller';
import { SubscriptionsCron } from './crons/subscriptions.cron';
import { PauseCompletionProcessorService } from './processors/pause-completion.processor';
import { MailModule } from 'src/mail/mail.module';
import { PrismaModule } from 'src/prisma';
import { WalletModule } from '../wallet/wallet.module';
import { NotificationModule } from 'src/notification/notification.module';

@Module({
  imports: [MailModule, PrismaModule, WalletModule, NotificationModule],
  controllers: [
    SubscriptionsController,
    SubscriptionsPauseController,
    SubscriptionsRefundController,
  ],
  providers: [
    SubscriptionsService,
    SubscriptionLogsService,
    SubscriptionsCron,
    PauseCompletionProcessorService,
  ],
  exports: [SubscriptionsService, SubscriptionLogsService],
})
export class SubscriptionsModule {}
