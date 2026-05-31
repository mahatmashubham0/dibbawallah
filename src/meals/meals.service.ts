import { Injectable, NotFoundException } from '@nestjs/common';
import { Meal, Prisma } from '@prisma/client';
import { PrismaService } from 'src/prisma';

@Injectable()
export class MealsService {
  constructor(private readonly prisma: PrismaService) {}

  async createMeal(data: {
    vendorId: number;
    name: string;
    description?: string;
    price: number;
    totalTifin: number;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const vendor = await tx.vendor.findUnique({
        where: {
          id: data.vendorId,
        },
        select: {
          id: true,
        },
      });

      if (!vendor) {
        throw new NotFoundException('Vendor not found');
      }

      const meal = await tx.meal.create({
        data: {
          vendorId: data.vendorId,
          name: data.name,
          description: data.description,
        },
      });

      const version = await tx.mealVersion.create({
        data: {
          mealId: meal.id,
          versionNumber: 1,
          name: data.name,
          description: data.description,
          price: data.price,
          totalTifin: data.totalTifin ?? 0,
        },
      });

      await tx.meal.update({
        where: {
          id: meal.id,
        },
        data: {
          currentVersionId: version.id,
        },
      });

      return meal;
    });
  }

  async updateMeal(
    mealId: number,
    data: {
      vendorId: number;
      name?: string;
      description?: string;
      price?: number;
      totalTifin?: number;
    },
  ) {
    return this.prisma.$transaction(async (tx) => {
      const meal = await tx.meal.findUnique({
        where: {
          id: mealId,
        },
        include: {
          currentVersion: true,
        },
      });

      if (!meal) {
        throw new NotFoundException('Meal not found');
      }

      const currentVersion = meal.currentVersion;
      const changed =
        data.name !== undefined ||
        data.description !== undefined ||
        data.price !== undefined ||
        data.totalTifin !== undefined;

      if (!changed) {
        return meal;
      }

      const version = await tx.mealVersion.create({
        data: {
          mealId: meal.id,
          versionNumber: currentVersion!.versionNumber + 1,
          name: data.name ?? currentVersion!.name,
          description: data.description ?? currentVersion!.description,
          price: data.price ?? currentVersion!.price,
          totalTifin: data.totalTifin ?? currentVersion!.totalTifin,
        },
      });

      return tx.meal.update({
        where: {
          id: meal.id,
        },
        data: {
          name: version.name,
          description: version.description,
          currentVersionId: version.id,
        },
      });
    });
  }

  async getVendorMeals(vendorId: number) {
    return this.prisma.meal.findMany({
      where: {
        vendorId,
        isActive: true,
      },
      select: {
        id: true,
        name: true,
        currentVersion: {
          select: {
            price: true,
            totalTifin: true,
          },
        },
      },
      orderBy: {
        id: 'desc',
      },
    });
  }

  async getMealById(id: number) {
    return this.prisma.meal.findUnique({
      where: {
        id,
      },
      include: {
        currentVersion: true,
        vendor: {
          select: {
            id: true,
            businessName: true,
          },
        },
      },
    });
  }

  async getMealVersions(mealId: number) {
    return this.prisma.mealVersion.findMany({
      where: {
        mealId,
      },
      orderBy: {
        versionNumber: 'desc',
      },
    });
  }

  async getAllMeals(options?: {
    search?: string;
    skip?: number;
    take?: number;
  }): Promise<{
    count: number;
    skip: number;
    take: number;
    data: Meal[];
  }> {
    const search = options?.search?.trim();
    const pagination = { skip: options?.skip || 0, take: options?.take || 10 };
    const where: Prisma.MealWhereInput = {};
    if (search) {
      const buildSearchFilter = (search: string): Prisma.MealWhereInput[] => [
        {
          name: {
            contains: search,
            mode: 'insensitive',
          },
        },
        {
          description: {
            contains: search,
            mode: 'insensitive',
          },
        },
      ];
      const parts = search.split(' ');
      if (parts.length !== 0) {
        where.AND = [];
        for (const part of parts) {
          if (part.trim()) {
            where.AND.push({
              OR: buildSearchFilter(part.trim()),
            });
          }
        }
      }
    }

    const totalMeals = await this.prisma.meal.count({
      where,
    });
    const meals = await this.prisma.meal.findMany({
      where,
      orderBy: { id: Prisma.SortOrder.asc },
      skip: pagination.skip,
      take: pagination.take,
    });

    return {
      count: totalMeals,
      skip: pagination.skip,
      take: pagination.take,
      data: meals,
    };
  }
}
