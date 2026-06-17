import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma';
import { CreateDailyMenuDto, GetDailyMenusDto } from './dto';
import { MealType, Prisma, DailyMenu } from '@prisma/client';
import { getISTStartOfDay } from './utils';

@Injectable()
export class DailyMenuService {
  constructor(private readonly prisma: PrismaService) {}

  async upsertDailyMenu(vendorId: number, data: CreateDailyMenuDto) {
    const menuDate = getISTStartOfDay(data.menuDate);

    const today = getISTStartOfDay(new Date().toISOString().split('T')[0]);
    if (menuDate.getTime() !== today.getTime()) {
      throw new BadRequestException('Menu can only be created for today');
    }

    return this.prisma.dailyMenu.upsert({
      where: {
        vendorId_mealType_menuDate: {
          vendorId,
          mealType: data.mealType,
          menuDate,
        },
      },

      update: {
        specialNote: data.specialNote,
        dishes: {
          deleteMany: {},
          create: data.dishes.map((dish, index) => ({
            dishName: dish.dishName,
            displayOrder: dish.displayOrder ?? index,
          })),
        },
      },

      create: {
        vendorId,
        mealType: data.mealType,
        menuDate,
        specialNote: data.specialNote,
        isNotified: false,
        dishes: {
          create: data.dishes.map((dish, index) => ({
            dishName: dish.dishName,
            displayOrder: dish.displayOrder ?? index,
          })),
        },
      },

      include: {
        dishes: {
          orderBy: {
            displayOrder: 'asc',
          },
        },
      },
    });
  }

  async getVendorDailyMenus(
    vendorId: number,
    options?: GetDailyMenusDto,
  ): Promise<{
    count: number;
    skip: number;
    take: number;
    data: DailyMenu[];
  }> {
    const pagination = {
      skip: options?.skip || 0,
      take: options?.take || 10,
    };
    const where: Prisma.DailyMenuWhereInput = {
      vendorId,
    };
    if (options?.date) {
      const startOfDay = getISTStartOfDay(options.date);
      const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000);

      where.menuDate = {
        gte: startOfDay,
        lt: endOfDay,
      };
    }

    if (options?.mealType) {
      where.mealType = options.mealType;
    }
    const search = options?.search?.trim();

    if (search) {
      const parts = search.split(' ').filter(Boolean);

      where.AND = parts.map((part) => ({
        OR: [
          {
            specialNote: {
              contains: part,
              mode: 'insensitive',
            },
          },
          {
            dishes: {
              some: {
                dishName: {
                  contains: part,
                  mode: 'insensitive',
                },
              },
            },
          },
        ],
      }));
    }

    const totalMenus = await this.prisma.dailyMenu.count({
      where,
    });

    const menus = await this.prisma.dailyMenu.findMany({
      where,
      include: {
        dishes: {
          orderBy: {
            displayOrder: 'asc',
          },
        },
      },
      orderBy: [
        {
          menuDate: 'desc',
        },
        {
          mealType: 'asc',
        },
      ],
      skip: pagination.skip,
      take: pagination.take,
    });

    return {
      count: totalMenus,
      skip: pagination.skip,
      take: pagination.take,
      data: menus,
    };
  }
}
