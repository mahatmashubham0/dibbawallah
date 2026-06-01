import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from 'src/prisma';
import { MailService } from 'src/mail/mail.service';
import { MealType } from '@prisma/client';
import { getISTStartOfDay } from '../utils';

@Injectable()
export class DailyMenuCron {
  private readonly logger = new Logger(DailyMenuCron.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mailService: MailService,
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

    for (const vendor of vendors) {
      // Mocking email since Vendor model doesn't have an email field
      const vendorEmail = `vendor_${vendor.id}@example.com`;

      const mailPayload = this.mailService.configureMessage(
        vendorEmail,
        `Reminder: Post ${mealType} Menu for Today`,
        `<p>Hello ${vendor.businessName},</p><p>Please remember to post your ${mealType} menu for today!</p>`,
      );

      await this.mailService.send({
        to: mailPayload.to as string,
        subject: mailPayload.subject as string,
        mailBodyOrTemplate: mailPayload.html as string,
      });

      this.logger.log(`Sent ${mealType} reminder to Vendor ID: ${vendor.id}`);
    }
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
