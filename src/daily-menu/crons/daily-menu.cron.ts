import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from 'src/prisma';
import { NotificationService } from 'src/notification/notification.service';
import { NotificationTemplateKey } from 'src/notification/types/notification-template-key.enum';
import { MealType } from '@prisma/client';
import { getISTStartOfDay } from '../utils';

@Injectable()
export class DailyMenuCron {
  private readonly logger = new Logger(DailyMenuCron.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationService: NotificationService,
  ) { }

  private async remindVendors(mealType: MealType) {
    const dateQuery = getISTStartOfDay(new Date().toISOString());

    const vendors = await this.prisma.vendor.findMany({
      where: {
        status: 'Active',
        dailyMenus: {
          none: {
            menuDate: dateQuery,
            mealType: mealType,
          },
        },
      },
    });

    if (vendors.length === 0) {
      this.logger.log(`No active vendors need a ${mealType} reminder today.`);
      return;
    }

    let templateKey: NotificationTemplateKey;
    if (mealType === MealType.Breakfast) {
      templateKey = NotificationTemplateKey.BREAKFAST_MENU_REMINDER;
    } else if (mealType === MealType.Lunch) {
      templateKey = NotificationTemplateKey.LUNCH_MENU_REMINDER;
    } else {
      templateKey = NotificationTemplateKey.DINNER_MENU_REMINDER;
    }

    const notificationPromises = vendors.map(async (vendor) => {
      try {
        await this.notificationService.sendNotificationWithTemplate(
          vendor.id,
          templateKey,
          { vendorName: vendor.fullName }
        );
        this.logger.log(`Sent ${mealType} reminder notification to Vendor ID: ${vendor.id}`);
      } catch (error) {
        this.logger.error(`Failed to send ${mealType} reminder notification to Vendor ID: ${vendor.id}`, error);
      }
    });

    await Promise.all(notificationPromises);
  }

  @Cron('0 7 * * *', { timeZone: 'Asia/Kolkata' })
  async handleBreakfastReminder() {
    this.logger.log('Running 7 AM Breakfast Menu Reminder');
    await this.remindVendors(MealType.Breakfast);
  }

  @Cron('0 11 * * *', { timeZone: 'Asia/Kolkata' })
  async handleLunchReminder() {
    this.logger.log('Running 11 AM Lunch Menu Reminder');
    await this.remindVendors(MealType.Lunch);
  }

  @Cron('0 18 * * *', { timeZone: 'Asia/Kolkata' })
  async handleDinnerReminder() {
    this.logger.log('Running 6 PM Dinner Menu Reminder');
    await this.remindVendors(MealType.Dinner);
  }
}
