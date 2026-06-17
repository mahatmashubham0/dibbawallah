import { BaseService, UtilsService } from '@Common';
import {
  Injectable,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma';
import { MailService } from 'src/mail/mail.service';
import { DailyMenu, Vendor, DailyMenuDish } from '@prisma/client';
import { NotificationService } from 'src/notification/notification.service';

@Injectable()
export class MenuNotificationProcessorService
  extends BaseService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private isIdle = true;
  private isShuttingDown = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly utilsService: UtilsService,
    private readonly mailService: MailService,
    private readonly notificationService: NotificationService,
  ) {
    super();
  }

  async onApplicationBootstrap() {
    setTimeout(() => this.run(), 10000);
  }

  async onModuleDestroy() {
    this.isShuttingDown = true;
    await this.utilsService.waitUntilValue(() => this.isIdle, true);
  }

  private async run() {
    if (this.isShuttingDown || !this.isIdle) return;

    this.isIdle = false;

    try {
      const unnotifiedMenus = await this.prisma.dailyMenu.findMany({
        where: {
          isNotified: false,
        },
        include: {
          vendor: true,
          dishes: true,
        },
        take: 10,
      });

      for (const menu of unnotifiedMenus) {
        if (this.isShuttingDown) break;

        await this.notifyUsers(menu);
      }
    } catch (err) {
      this.logger.error('Menu notification processor error', err);
    } finally {
      this.isIdle = true;

      if (!this.isShuttingDown) {
        setTimeout(() => this.run(), 2000);
      }
    }
  }

  private async notifyUsers(
    menu: DailyMenu & { vendor: Vendor; dishes: DailyMenuDish[] },
  ) {
    try {
      const subscriptions = await this.prisma.subscription.findMany({
        where: { vendorId: menu.vendorId, status: 'Active' },
        select: {
          vendorCustomer: {
            select: {
              customer: {
                select: { userId: true },
              },
            },
          },
        },
      });
      console.log('subscriptions', subscriptions);

      const userIds = [
        ...new Set(
          subscriptions
            .map((sub) => sub.vendorCustomer.customer.userId)
            .filter((id): id is number => id !== null),
        ),
      ];

      if (userIds.length > 0) {
        const users = await this.prisma.user.findMany({
          where: {
            id: { in: userIds },
            status: 'Active',
            email: { not: '' },
          },
        });

        const activeUserIds = users.map((user) => user.id);
        const menuItems =
          menu.dishes.length > 0
            ? menu.dishes
                .sort((a, b) => a.displayOrder - b.displayOrder)
                .map((d) => d.dishName)
                .join(', ')
            : '';

        const variablesMap = users.reduce(
          (acc, user) => {
            acc[user.id] = {
              vendorName: menu.vendor.businessName,
              mealType: menu.mealType,
              menuItems,
            };
            return acc;
          },
          {} as Record<number, Record<string, any>>,
        );

        await this.notificationService.sendNotificationToUsers(
          activeUserIds,
          'NEW_MENU_POSTED',
          variablesMap,
          {
            extraData: { menuId: String(menu.id), type: 'NewMenu' },
            actorId: menu.vendorId,
          },
        );
      } else {
        this.logger.warn(
          `No customers found for vendor ID: ${menu.vendorId} to notify about menu ID: ${menu.id}`,
        );
      }

      // Mark the menu as notified
      await this.prisma.dailyMenu.update({
        where: { id: menu.id },
        data: { isNotified: true },
      });

      this.logger.info(`Notified users for daily menu ID: ${menu.id}`);
    } catch (err) {
      this.logger.error(
        `Failed to notify users for daily menu ID: ${menu.id}`,
        err,
      );
    }
  }
}
