import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DeliveryStatus, Prisma } from '@prisma/client';
import { UserType } from '@Common';
import { PrismaService } from '../prisma';
import { WalletService } from '../wallet/wallet.service';
import { GetDeliveriesQueryDto } from './dto';

@Injectable()
export class DeliveriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly walletService: WalletService,
  ) {}

  async getAll(
    query: GetDeliveriesQueryDto,
    loggedInUser: { id: number; type: UserType },
  ) {
    const isVendor = loggedInUser.type === UserType.Vendor;
    const targetVendorId = isVendor ? loggedInUser.id : query.vendorId;

    const where: Prisma.MealDeliveryWhereInput = {};

    const subscriptionFilter: Prisma.SubscriptionWhereInput = {};

    // 1. Vendor scoping
    if (targetVendorId !== undefined) {
      subscriptionFilter.vendorId = targetVendorId;
    }

    // 2. Date filtering
    const targetDate = query.date ? new Date(query.date) : new Date();
    const startOfDay = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate());
    const endOfDay = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate(), 23, 59, 59, 999);
    
    where.deliveryDate = {
      gte: startOfDay,
      lte: endOfDay,
    };

    // 3. Status filtering
    if (query.status) {
      where.status = query.status;
    }

    // 4. Meal Type filtering (stored in deliveryTime column as string)
    if (query.mealType) {
      where.deliveryTime = query.mealType;
    }

    // 5. Search filtering (customer name or number)
    if (query.search) {
      const searchString = query.search.trim();
      subscriptionFilter.vendorCustomer = {
        customer: {
          OR: [
            { fullName: { contains: searchString, mode: 'insensitive' } },
            { mobileNumber: { contains: searchString, mode: 'insensitive' } },
          ],
        },
      };
    }

    if (Object.keys(subscriptionFilter).length > 0) {
      where.subscription = subscriptionFilter;
    }

    // 6. Metrics aggregation (un-paginated and un-filtered by status/mealType/search, for today's totals)
    const statsWhere: Prisma.MealDeliveryWhereInput = {
      deliveryDate: {
        gte: startOfDay,
        lte: endOfDay,
      },
    };
    if (targetVendorId !== undefined) {
      statsWhere.subscription = {
        vendorId: targetVendorId,
      };
    }

    const allTodayDeliveries = await this.prisma.mealDelivery.findMany({
      where: statsWhere,
      select: {
        status: true,
        deliveryTime: true,
      },
    });

    const metrics = {
      total: allTodayDeliveries.length,
      preparing: allTodayDeliveries.filter((d) => d.status === DeliveryStatus.Pending).length,
      delivered: allTodayDeliveries.filter((d) => d.status === DeliveryStatus.Delivered).length,
      lunch: allTodayDeliveries.filter((d) => d.deliveryTime?.toLowerCase() === 'lunch').length,
      dinner: allTodayDeliveries.filter((d) => d.deliveryTime?.toLowerCase() === 'dinner').length,
    };

    // 7. Paginated data query
    const count = await this.prisma.mealDelivery.count({ where });
    const data = await this.prisma.mealDelivery.findMany({
      where,
      include: {
        subscription: {
          include: {
            vendorCustomer: {
              include: {
                customer: true,
              },
            },
            planVersion: {
              include: {
                plan: true,
              },
            },
          },
        },
      },
      skip: query.skip || 0,
      take: query.take || 10,
      orderBy: { id: 'asc' },
    });

    return {
      metrics,
      count,
      skip: query.skip || 0,
      take: query.take || 10,
      data,
    };
  }

  async getById(id: number, loggedInUser: { id: number; type: UserType }) {
    const delivery = await this.prisma.mealDelivery.findUnique({
      where: { id },
      include: {
        subscription: {
          include: {
            vendorCustomer: {
              include: {
                customer: true,
              },
            },
            planVersion: {
              include: {
                plan: true,
              },
            },
          },
        },
      },
    });

    if (!delivery) {
      throw new NotFoundException(`Delivery record with ID ${id} not found`);
    }

    if (loggedInUser.type === UserType.Vendor && delivery.subscription.vendorId !== loggedInUser.id) {
      throw new ForbiddenException('You do not have access to this delivery record');
    }

    return delivery;
  }

  async updateStatus(
    id: number,
    status: DeliveryStatus,
    loggedInUser: { id: number; type: UserType },
  ) {
    const delivery = await this.prisma.mealDelivery.findUnique({
      where: { id },
      include: {
        subscription: true,
      },
    });

    if (!delivery) {
      throw new NotFoundException(`Delivery record with ID ${id} not found`);
    }

    if (loggedInUser.type === UserType.Vendor && delivery.subscription.vendorId !== loggedInUser.id) {
      throw new ForbiddenException('You do not have access to this delivery record');
    }

    const vendorId = loggedInUser.type === UserType.Vendor ? loggedInUser.id : delivery.subscription.vendorId;

    // Use walletService to process delivery so credits/wallets are adjusted correctly
    return await this.walletService.processMealDelivery(vendorId, id, status);
  }
}
