import { Module } from '@nestjs/common';
import { DailyMenuService } from './daily-menu.service';
import { DailyMenuController } from './daily-menu.controller';
import { DailyMenuCron } from './crons/daily-menu.cron';
import { MenuNotificationProcessorService } from './processors/menu-notification.processor';
import { MailModule } from 'src/mail/mail.module';
import { PrismaModule } from 'src/prisma';
import { NotificationModule } from 'src/notification/notification.module';

@Module({
  imports: [MailModule, PrismaModule, NotificationModule],
  controllers: [DailyMenuController],
  providers: [DailyMenuService, DailyMenuCron, MenuNotificationProcessorService],
})
export class DailyMenuModule { }
