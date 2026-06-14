import { BadRequestException, Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { PriceType, Prisma } from '@prisma/client';
import { PrismaService } from 'src/prisma';
import {
  CreateMealDto,
  UpdateMealDto,
  CreateMealPlanDto,
  UpdateMealPlanDto,
} from './dto';

@Injectable()
export class MealsService {
  constructor(private readonly prisma: PrismaService) { }

  // ==========================================
  // BASE MEAL MANAGEMENT
  // ==========================================

  async createMeal(vendorId: number, data: CreateMealDto) {
    return this.prisma.meal.create({
      data: {
        vendorId,
        name: data.name,
        mealMeta: data.mealMeta
          ? {
            create: {
              deliveryTime: data.mealMeta.deliveryTime,
              cancellationCutoffMinutes:
                data.mealMeta.cancellationCutoffMinutes,
            },
          }
          : undefined,
        items: data.items?.length
          ? {
            create: data.items.map((item) => ({
              name: item.name,
              isOptional: item.isOptional ?? false,
            })),
          }
          : undefined,
      },
      include: {
        mealMeta: true,
        items: true,
      },
    });
  }

  async updateMeal(
    vendorId: number,
    mealId: number,
    data: UpdateMealDto,
  ) {
    const meal = await this.prisma.meal.findFirst({
      where: {
        id: mealId,
        vendorId,
      },
      include: {
        mealMeta: true,
      },
    });

    if (!meal) {
      throw new NotFoundException('Meal not found');
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.meal.update({
        where: { id: mealId },
        data: {
          ...(data.name !== undefined && { name: data.name }),
          ...(data.isActive !== undefined && {
            isActive: data.isActive,
          }),
        },
      });

      if (data.mealMeta) {
        if (meal.mealMeta) {
          await tx.mealMeta.update({
            where: {
              mealId,
            },
            data: {
              deliveryTime: data.mealMeta.deliveryTime,
              cancellationCutoffMinutes:
                data.mealMeta.cancellationCutoffMinutes,
            },
          });
        } else {
          await tx.mealMeta.create({
            data: {
              mealId,
              deliveryTime: data.mealMeta.deliveryTime,
              cancellationCutoffMinutes:
                data.mealMeta.cancellationCutoffMinutes,
            },
          });
        }
      }

      if (data.items) {
        await tx.mealItem.deleteMany({
          where: {
            mealId,
          },
        });

        if (data.items.length) {
          await tx.mealItem.createMany({
            data: data.items.map((item) => ({
              mealId,
              name: item.name,
              isOptional: item.isOptional ?? false,
            })),
          });
        }
      }
    });
  }

  async getVendorMeals(
    vendorId: number,
    options?: {
      search?: string;
      skip?: number;
      take?: number;
    },
  ) {
    const search = options?.search?.trim();

    const pagination = {
      skip: options?.skip ?? 0,
      take: options?.take ?? 10,
    };

    const where: Prisma.MealWhereInput = {
      vendorId,
    };

    if (search) {
      const buildSearchFilter = (
        value: string,
      ): Prisma.MealWhereInput[] => [
          {
            name: {
              contains: value,
              mode: 'insensitive',
            },
          },
        ];

      const parts = search.split(' ');

      where.AND = [];

      for (const part of parts) {
        if (part.trim()) {
          where.AND.push({
            OR: buildSearchFilter(part.trim()),
          });
        }
      }
    }

    const totalMeals = await this.prisma.meal.count({
      where,
    });

    const meals = await this.prisma.meal.findMany({
      where,
      orderBy: {
        id: Prisma.SortOrder.asc,
      },
      skip: pagination.skip,
      take: pagination.take,
      include: {
        mealMeta: true,
        items: {
          select: {
            id: true,
            name: true,
            isOptional: true,
          },
        },
      },
    });

    return {
      count: totalMeals,
      skip: pagination.skip,
      take: pagination.take,
      data: meals,
    };
  }


  async getMealById(mealId: number) {
    return this.prisma.meal.findUnique({
      where: { id: mealId },
      include: {
        items: true,
        mealMeta: true,
      }
    });
  }


  async deleteMeal(vendorId: number, mealId: number) {
    const meal = await this.prisma.meal.findFirst({
      where: {
        id: mealId,
        vendorId,
      },
      select: {
        id: true,
      },
    });

    if (!meal) {
      throw new NotFoundException('Meal not found');
    }

    await this.prisma.meal.delete({
      where: {
        id: mealId,
      },
    });

    return {
      success: true,
      message: 'Meal deleted successfully',
    };
  }

  // ==========================================
  // MEAL PLAN MANAGEMENT (VERSIONED)
  // ==========================================


  async createMealPlan(vendorId: number, data: CreateMealPlanDto) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const meals = await tx.meal.findMany({
          where: {
            id: {
              in: data.meals,
            },
            vendorId,
            isActive: true,
          },
          select: {
            id: true,
          },
        });

        const foundMealIds = meals.map((meal) => meal.id);

        const invalidMealIds = data.meals.filter(
          (mealId) => !foundMealIds.includes(mealId),
        );

        if (invalidMealIds.length > 0) {
          throw new BadRequestException(
            `Invalid meal ids: ${invalidMealIds.join(', ')}`,
          );
        }

        const plan = await tx.mealPlan.create({
          data: {
            vendorId,
            name: data.name,
            description: data.description,
          },
        });

        const version = await tx.mealPlanVersion.create({
          data: {
            planId: plan.id,
            versionNumber: 1,
            totalTiffins: data.totalTiffins,
            meals: {
              createMany: {
                data: data.meals.map((mealId) => ({
                  mealId,
                })),
              },
            },
            prices: {
              createMany: {
                data: data.prices.map((price) => ({
                  priceType: price.priceType,
                  amount: price.amount,
                })),
              },
            },
          },
        });

        await tx.mealPlan.update({
          where: {
            id: plan.id,
          },
          data: {
            currentVersionId: version.id,
          },
        });
      });
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }

      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2003'
      ) {
        throw new BadRequestException(
          'One or more selected meals do not exist',
        );
      }

      throw new InternalServerErrorException(
        'Failed to create meal plan',
      );
    }
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
  }

  async getVendorPlans(
    vendorId: number,
    options?: {
      search?: string;
      skip?: number;
      take?: number;
    },
  ) {
    const search = options?.search?.trim();
    const pagination = {
      skip: options?.skip ?? 0,
      take: options?.take ?? 10,
    };

    const where: Prisma.MealPlanWhereInput = {
      vendorId,
      isActive: true,
    };

    if (search) {
      const buildSearchFilter = (
        value: string,
      ): Prisma.MealPlanWhereInput[] => [
          {
            name: {
              contains: value,
              mode: 'insensitive',
            },
          },
          {
            description: {
              contains: value,
              mode: 'insensitive',
            },
          },
        ];

      const parts = search.split(' ');

      where.AND = [];

      for (const part of parts) {
        if (part.trim()) {
          where.AND.push({
            OR: buildSearchFilter(part.trim()),
          });
        }
      }
    }

    const totalPlans = await this.prisma.mealPlan.count({
      where,
    });

    const plans = await this.prisma.mealPlan.findMany({
      where,
      orderBy: {
        id: Prisma.SortOrder.asc,
      },
      skip: pagination.skip,
      take: pagination.take,
      include: {
        currentVersion: {
          include: {
            meals: {
              include: {
                meal: {
                  include: {
                    mealMeta: true,
                  },
                },
              },
            },
            prices: true,
          },
        },
      },
    });

    return {
      count: totalPlans,
      skip: pagination.skip,
      take: pagination.take,
      data: plans.map((plan) =>
        this.formatPlanResponse(plan),
      ),
    };
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

    const monthlyPrice = currentVersion.prices?.find(
      (p: any) => p.priceType === PriceType.Monthly,
    );

    return {
      id: plan.id,
      name: plan.name,
      description: plan.description,
      meals: currentVersion.meals?.map((m: any) => m.meal.name) || [],
      price: monthlyPrice ? Number(monthlyPrice.amount) : 0,
      totalTiffins: currentVersion.totalTiffins,
      version: {
        id: currentVersion.id,
        versionNumber: currentVersion.versionNumber,
        effectiveFrom: currentVersion.effectiveFrom,
        meals:
          currentVersion.meals?.map((m: any) => ({
            id: m.meal.id,
            name: m.meal.name,
            deliveryTime: m.meal.mealMeta?.deliveryTime,
            cancellationCutoffMinutes:
              m.meal.mealMeta?.cancellationCutoffMinutes,
          })) || [],

        prices:
          currentVersion.prices?.map((p: any) => ({
            type: p.priceType,
            amount: Number(p.amount),
          })) || [],
      },
    };
  }

  async deleteMealPlan(
    vendorId: number,
    planId: number,
  ) {
    const plan = await this.prisma.mealPlan.findFirst({
      where: {
        id: planId,
        vendorId,
      },
      select: {
        id: true,
      },
    });
    if (!plan) {
      throw new NotFoundException('Meal plan not found');
    }
    await this.prisma.mealPlan.delete({
      where: {
        id: planId,
      },
    });
    return {
      success: true,
      message: 'Meal plan deleted successfully',
    };
  }
}
