import { Injectable, NotFoundException } from '@nestjs/common';
import { MealType } from '@prisma/client';
import { PrismaService } from 'src/prisma';
import { CreateMealPlanDto, UpdateMealPlanDto } from './dto/meal-plan.dto';

@Injectable()
export class MealsService {
  constructor(private readonly prisma: PrismaService) { }

  // ==========================================
  // MEAL PLAN MANAGEMENT (VERSIONED)
  // ==========================================

  async createMealPlan(vendorId: number, data: CreateMealPlanDto) {
    return this.prisma.$transaction(async (tx) => {
      // Find or create high-level meal category for this vendor
      let meal = await tx.meal.findFirst({
        where: { vendorId, mealType: data.mealType, isActive: true },
      });

      if (!meal || data.mealType === MealType.Custom) {
        meal = await tx.meal.create({
          data: {
            vendorId,
            name:
              data.mealType === MealType.Custom
                ? data.name
                : data.mealType.charAt(0).toUpperCase() + data.mealType.slice(1).toLowerCase(),
            mealType: data.mealType,
            description: `${data.mealType} meal category`,
          },
        });
      }

      const plan = await tx.mealPlan.create({
        data: {
          mealId: meal.id,
        },
      });

      const version = await tx.mealPlanVersion.create({
        data: {
          planId: plan.id,
          versionNumber: 1,
          name: data.name,
          description: data.description,
          price: data.price,
          totalTifin: data.totalTifin,
          items: {
            create: data.items.map((i) => ({
              name: i.name,
              quantity: i.quantity,
            })),
          },
        },
      });

      await tx.mealPlan.update({
        where: { id: plan.id },
        data: { currentVersionId: version.id },
      });

      return tx.mealPlan.findUnique({
        where: { id: plan.id },
        include: {
          meal: true,
          currentVersion: {
            include: {
              items: true,
            },
          },
        },
      });
    });
  }

  async updateMealPlan(vendorId: number, planId: number, data: UpdateMealPlanDto) {
    const plan = await this.prisma.mealPlan.findFirst({
      where: { id: planId, meal: { vendorId } },
      include: {
        currentVersion: {
          include: {
            items: true,
          },
        },
      },
    });

    if (!plan) {
      throw new NotFoundException('Meal plan not found');
    }

    const currentVersion = plan.currentVersion;
    if (!currentVersion) {
      throw new NotFoundException('Plan version mapping in DB is corrupted');
    }

    // Determine if anything important has actually changed
    const itemsChanged = data.items
      ? JSON.stringify(data.items.sort((a, b) => a.name.localeCompare(b.name))) !==
      JSON.stringify(
        currentVersion.items
          .map((i) => ({ name: i.name, quantity: i.quantity }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      )
      : false;

    const changed =
      (data.name !== undefined && data.name !== currentVersion.name) ||
      (data.description !== undefined && data.description !== currentVersion.description) ||
      (data.price !== undefined && Number(data.price) !== Number(currentVersion.price)) ||
      (data.totalTifin !== undefined && data.totalTifin !== currentVersion.totalTifin) ||
      itemsChanged;

    if (!changed) {
      return plan;
    }

    // Since a property changed, create a new version to guarantee integrity for subscribers
    return this.prisma.$transaction(async (tx) => {
      const nextVersionNumber = currentVersion.versionNumber + 1;

      const finalName = data.name !== undefined ? data.name : currentVersion.name;
      const finalDescription =
        data.description !== undefined ? data.description : currentVersion.description;
      const finalPrice = data.price !== undefined ? data.price : currentVersion.price;
      const finalTotalTifin =
        data.totalTifin !== undefined ? data.totalTifin : currentVersion.totalTifin;

      const finalItems = data.items
        ? data.items.map((i) => ({ name: i.name, quantity: i.quantity }))
        : currentVersion.items.map((i) => ({ name: i.name, quantity: i.quantity }));

      const version = await tx.mealPlanVersion.create({
        data: {
          planId: plan.id,
          versionNumber: nextVersionNumber,
          name: finalName,
          description: finalDescription,
          price: finalPrice,
          totalTifin: finalTotalTifin,
          items: {
            create: finalItems,
          },
        },
      });

      await tx.mealPlan.update({
        where: { id: plan.id },
        data: { currentVersionId: version.id },
      });

      return tx.mealPlan.findUnique({
        where: { id: plan.id },
        include: {
          meal: true,
          currentVersion: {
            include: {
              items: true,
            },
          },
        },
      });
    });
  }

  async getVendorPlans(vendorId: number) {
    return this.prisma.mealPlan.findMany({
      where: { meal: { vendorId }, isActive: true },
      include: {
        meal: true,
        currentVersion: {
          include: {
            items: true,
          },
        },
      },
    });
  }

  async getPlanById(id: number) {
    const plan = await this.prisma.mealPlan.findUnique({
      where: { id },
      include: {
        meal: true,
        currentVersion: {
          include: {
            items: true,
          },
        },
      },
    });

    if (!plan) {
      throw new NotFoundException('Meal plan not found');
    }

    return plan;
  }
}
