import { Injectable, NotFoundException } from '@nestjs/common';
import { PriceType } from '@prisma/client';
import { PrismaService } from 'src/prisma';
import {
  CreateMealDto,
  UpdateMealDto,
  CreateMealPlanDto,
  UpdateMealPlanDto,
} from './dto';

@Injectable()
export class MealsService {
  constructor(private readonly prisma: PrismaService) {}

  // ==========================================
  // BASE MEAL MANAGEMENT
  // ==========================================

  async createMeal(vendorId: number, data: CreateMealDto) {
    return this.prisma.meal.create({
      data: {
        vendorId,
        name: data.name,
        items: data.items
          ? {
              create: data.items.map((item) => ({
                name: item.name,
                isOptional: item.isOptional || false,
              })),
            }
          : undefined,
      },
      include: { items: true },
    });
  }

  async updateMeal(vendorId: number, id: number, data: UpdateMealDto) {
    const meal = await this.prisma.meal.findFirst({
      where: { id, vendorId },
    });
    if (!meal) throw new NotFoundException('Meal not found');

    return this.prisma.$transaction(async (tx) => {
      await tx.meal.update({
        where: { id },
        data: {
          name: data.name,
          isActive: data.isActive,
        },
      });

      if (data.items) {
        await tx.mealItem.deleteMany({ where: { mealId: id } });
        if (data.items.length > 0) {
          await tx.mealItem.createMany({
            data: data.items.map((item) => ({
              mealId: id,
              name: item.name,
              isOptional: item.isOptional || false,
            })),
          });
        }
      }

      return tx.meal.findUnique({
        where: { id },
        include: { items: true },
      });
    });
  }

  async getVendorMeals(vendorId: number) {
    return this.prisma.meal.findMany({
      where: { vendorId },
      include: { items: true },
    });
  }

  // ==========================================
  // MEAL PLAN MANAGEMENT (VERSIONED)
  // ==========================================

  async createMealPlan(vendorId: number, data: CreateMealPlanDto) {
    return this.prisma.$transaction(async (tx) => {
      // 1. Create the base Plan wrapper
      const plan = await tx.mealPlan.create({
        data: {
          vendorId,
          name: data.name,
          description: data.description,
        },
      });

      // 2. Create the first version
      const version = await tx.mealPlanVersion.create({
        data: {
          planId: plan.id,
          versionNumber: 1,
          totalTiffins: data.totalTiffins,
          meals: {
            create: data.meals.map((mealId) => ({ mealId })),
          },
          prices: {
            create: data.prices.map((price) => ({
              priceType: price.priceType,
              amount: price.amount,
            })),
          },
        },
      });

      // 3. Link the current version
      await tx.mealPlan.update({
        where: { id: plan.id },
        data: { currentVersionId: version.id },
      });

      return this.getPlanById(plan.id);
    });
  }

  async updateMealPlan(
    vendorId: number,
    planId: number,
    data: UpdateMealPlanDto,
  ) {
    const plan = await this.prisma.mealPlan.findFirst({
      where: { id: planId, vendorId },
      include: {
        currentVersion: {
          include: {
            meals: true,
            prices: true,
          },
        },
      },
    });

    if (!plan) throw new NotFoundException('Meal plan not found');

    const currentVersion = plan.currentVersion;
    if (!currentVersion)
      throw new NotFoundException('Plan version mapping in DB is corrupted');

    // Basic fields update
    if (
      data.name !== undefined ||
      data.description !== undefined ||
      data.isActive !== undefined
    ) {
      await this.prisma.mealPlan.update({
        where: { id: planId },
        data: {
          name: data.name,
          description: data.description,
          isActive: data.isActive,
        },
      });
    }

    // Determine if structural things (meals, prices, totalTiffins) changed, warranting a new version
    let needsNewVersion = false;

    if (data.meals) {
      const currentMealIds = currentVersion.meals.map((m) => m.mealId).sort();
      const newMealIds = [...data.meals].sort();
      if (JSON.stringify(currentMealIds) !== JSON.stringify(newMealIds)) {
        needsNewVersion = true;
      }
    }

    if (data.prices) {
      const currentPrices = currentVersion.prices
        .map((p) => ({ priceType: p.priceType, amount: Number(p.amount) }))
        .sort((a, b) => a.priceType.localeCompare(b.priceType));

      const newPrices = data.prices
        .map((p) => ({ priceType: p.priceType, amount: Number(p.amount) }))
        .sort((a, b) => a.priceType.localeCompare(b.priceType));

      if (JSON.stringify(currentPrices) !== JSON.stringify(newPrices)) {
        needsNewVersion = true;
      }
    }

    if (
      data.totalTiffins !== undefined &&
      data.totalTiffins !== currentVersion.totalTiffins
    ) {
      needsNewVersion = true;
    }

    if (needsNewVersion) {
      await this.prisma.$transaction(async (tx) => {
        const finalMeals =
          data.meals !== undefined
            ? data.meals
            : currentVersion.meals.map((m) => m.mealId);

        const finalPrices =
          data.prices !== undefined
            ? data.prices
            : currentVersion.prices.map((p) => ({
                priceType: p.priceType,
                amount: p.amount,
              }));

        const finalTotalTiffins =
          data.totalTiffins !== undefined
            ? data.totalTiffins
            : currentVersion.totalTiffins;

        const newVersion = await tx.mealPlanVersion.create({
          data: {
            planId: plan.id,
            versionNumber: currentVersion.versionNumber + 1,
            totalTiffins: finalTotalTiffins,
            meals: {
              create: finalMeals.map((mealId) => ({ mealId })),
            },
            prices: {
              create: finalPrices.map((price) => ({
                priceType: price.priceType,
                amount: price.amount,
              })),
            },
          },
        });

        await tx.mealPlan.update({
          where: { id: plan.id },
          data: { currentVersionId: newVersion.id },
        });
      });
    }

    return this.getPlanById(plan.id);
  }

  async getVendorPlans(vendorId: number) {
    const plans = await this.prisma.mealPlan.findMany({
      where: { vendorId, isActive: true },
      include: {
        currentVersion: {
          include: {
            meals: { include: { meal: true } },
            prices: true,
          },
        },
      },
    });

    return plans.map((p) => this.formatPlanResponse(p));
  }

  async getPlanById(id: number) {
    const plan = await this.prisma.mealPlan.findUnique({
      where: { id },
      include: {
        currentVersion: {
          include: {
            meals: { include: { meal: true } },
            prices: true,
          },
        },
      },
    });

    if (!plan) throw new NotFoundException('Meal plan not found');

    return this.formatPlanResponse(plan);
  }

  private formatPlanResponse(plan: any) {
    const currentVersion = plan.currentVersion;
    if (!currentVersion) return plan;

    const monthlyPriceObj = currentVersion.prices?.find(
      (p: any) => p.priceType === PriceType.Monthly,
    );

    return {
      id: plan.id,
      name: plan.name,
      description: plan.description,
      meals: currentVersion.meals?.map((m: any) => m.meal?.name) || [],
      price: monthlyPriceObj
        ? Number(monthlyPriceObj.amount)
        : currentVersion.prices?.[0]
          ? Number(currentVersion.prices[0].amount)
          : 0,
      totalTiffins: currentVersion.totalTiffins,
      currentVersionId: plan.currentVersionId,
      fullVersionData: currentVersion, // keeping it just in case clients need it
    };
  }
}
