import { BaseService, UtilsService } from '@Common';
import {
  Injectable,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma';
import { SubscriptionStatus, DeliveryStatus, Prisma, MealType } from '@prisma/client';

function mapToMealType(name: string): MealType {
  const lower = name.toLowerCase();
  if (lower === 'breakfast') return MealType.Breakfast;
  if (lower === 'lunch') return MealType.Lunch;
  if (lower === 'dinner') return MealType.Dinner;
  if (lower === 'custom_lunch') return MealType.CustomLunch;
  return MealType.Custom;
}

@Injectable()
export class DeliveryGeneratorProcessorService
  extends BaseService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private isIdle = true;
  private isShuttingDown = false;
  private lastGeneratedDateStr = '';

  constructor(
    private readonly prisma: PrismaService,
    private readonly utilsService: UtilsService,
  ) {
    super();
  }

  async onApplicationBootstrap() {
    // Start the processor loop after 10 seconds of app bootstrap
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
      const today = new Date();
      // Format as local YYYY-MM-DD to avoid timezone shifting issues
      const year = today.getFullYear();
      const month = String(today.getMonth() + 1).padStart(2, '0');
      const day = String(today.getDate()).padStart(2, '0');
      const todayStr = `${year}-${month}-${day}`;

      if (this.lastGeneratedDateStr !== todayStr) {
        this.logger.info(
          `Starting daily delivery generation loop for date: ${todayStr}`,
        );
        await this.generateDailyDeliveries(today);
        this.lastGeneratedDateStr = todayStr;
        this.logger.info(
          `Finished daily delivery generation loop for date: ${todayStr}`,
        );
      }
    } catch (err) {
      this.logger.error(
        'Delivery generator processor encountered an error',
        err,
      );
    } finally {
      this.isIdle = true;

      if (!this.isShuttingDown) {
        // Run check every 60 seconds to detect date change
        setTimeout(() => this.run(), 60000);
      }
    }
  }

  /**
   * Scans and generates Pending delivery rows for active subscriptions on target date.
   */
  async generateDailyDeliveries(targetDate: Date) {
    const deliveryDate = new Date(
      targetDate.getFullYear(),
      targetDate.getMonth(),
      targetDate.getDate(),
    );
    console.log('deliveryDate', deliveryDate);
    const subscriptions = await this.prisma.subscription.findMany({
      where: {
        status: SubscriptionStatus.Active,
      },
      include: {
        planVersion: {
          include: {
            meals: {
              include: {
                meal: true,
              },
            },
          },
        },
        vendorCustomer: {
          include: {
            wallet: true,
          },
        },
      },
    });

    this.logger.info(
      `Processing ${subscriptions.length} active subscriptions for delivery date: ${deliveryDate.toDateString()}`,
    );
    for (const sub of subscriptions) {
      if (this.isShuttingDown) break;

      try {
        await this.processSubscriptionDeliveries(sub, deliveryDate);
      } catch (err) {
        this.logger.error(
          `Error generating deliveries for Subscription ID: ${sub.id}`,
          err,
        );
      }
    }
  }

  private async processSubscriptionDeliveries(sub: any, deliveryDate: Date) {
    const wallet = sub.vendorCustomer.wallet;
    if (!wallet) {
      this.logger.warn(
        `No wallet found for VendorCustomer ID: ${sub.vendorCustomerId}. Skipping.`,
      );
      return;
    }

    const remainingCredits = wallet.totalCredits - wallet.usedCredits;
    // if (remainingCredits <= 0) {
    //   this.logger.warn(`Subscription ID: ${sub.id} has no remaining credits (balance: ${remainingCredits}). Setting status to Expired.`);
    //   await this.prisma.subscription.update({
    //     where: { id: sub.id },
    //     data: { status: SubscriptionStatus.Expired },
    //   });
    //   return;
    // }

    // Skip delivery generation if subscription has an active approved or completed pause request covering this date
    const activePause = await this.prisma.pauseRequest.findFirst({
      where: {
        subscriptionId: sub.id,
        status: { in: ['Approved', 'Completed'] },
        startDate: { lte: deliveryDate },
        endDate: { gte: deliveryDate },
      },
    });

    if (activePause) {
      this.logger.info(
        `Subscription ID: ${sub.id} is paused on ${deliveryDate.toDateString()}. Skipping delivery generation.`,
      );
      return;
    }

    const planVersion = sub.planVersion;
    if (!planVersion || !planVersion.meals || planVersion.meals.length === 0) {
      this.logger.warn(
        `No active meals found for plan version ID: ${sub.planVersionId}. Skipping.`,
      );
      return;
    }

    for (const planMeal of planVersion.meals) {
      const meal = planMeal.meal;
      if (!meal || !meal.isActive) continue;

      // Check if delivery already exists for today's date and meal type to ensure idempotency
      const mealType = mapToMealType(meal.name);
      const existingDelivery = await this.prisma.delivery.findFirst({
        where: {
          subscriptionId: sub.id,
          deliveryDate,
          mealType,
        },
      });

      if (!existingDelivery) {
        await this.prisma.delivery.create({
          data: {
            subscriptionId: sub.id,
            vendorId: sub.vendorId,
            customerId: sub.vendorCustomer.customerId,
            deliveryDate,
            mealType,
            mealSnapshot: meal as any,
            status: DeliveryStatus.Pending,
          },
        });
        this.logger.info(
          `Created Pending delivery for Sub ID: ${sub.id}, Meal: ${meal.name}, Date: ${deliveryDate.toISOString().split('T')[0]}`,
        );
      }
    }
  }
}
