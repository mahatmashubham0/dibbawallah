import { Module } from '@nestjs/common';
import { SubscriptionsService } from './subscriptions.service';
import { SubscriptionsController } from './subscriptions.controller';
import { SubscriptionsCron } from './crons/subscriptions.cron';
import { MailModule } from 'src/mail/mail.module';
import { PrismaModule } from 'src/prisma';

@Module({
  imports: [MailModule, PrismaModule],
  controllers: [SubscriptionsController],
  providers: [SubscriptionsService, SubscriptionsCron],
  exports: [SubscriptionsService],
})
export class SubscriptionsModule {}
