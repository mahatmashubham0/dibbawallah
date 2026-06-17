import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DeliveryStatus, Prisma } from '@prisma/client';
import { UserType } from '@Common';
import { PrismaService } from '../prisma';
import { WalletService } from '../wallet/wallet.service';
import { GetDeliveriesQueryDto, GetDailyDeliveriesReportDto } from './dto';

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

    // 1. Date filtering
    const targetDate = query.date ? new Date(query.date) : new Date();
    const startOfDay = new Date(
      targetDate.getFullYear(),
      targetDate.getMonth(),
      targetDate.getDate(),
    );
    const endOfDay = new Date(
      targetDate.getFullYear(),
      targetDate.getMonth(),
      targetDate.getDate(),
      23,
      59,
      59,
      999,
    );

    where.deliveryDate = {
      gte: startOfDay,
      lte: endOfDay,
    };

    // 2. Status filtering
    if (query.status) {
      where.status = query.status;
    }

    // 3. Build subscriptionFilter with arbitrary combinations of lowCredit, search, location, and mealType
    const subConditions: Prisma.SubscriptionWhereInput[] = [];

    if (targetVendorId !== undefined) {
      subConditions.push({ vendorId: targetVendorId });
    }

    if (query.lowCredit === 'true') {
      const lowCreditWallets = await this.prisma.wallet.findMany({
        where:
          targetVendorId !== undefined
            ? {
                vendorCustomer: {
                  vendorId: targetVendorId,
                },
              }
            : undefined,
        select: {
          vendorCustomerId: true,
          totalCredits: true,
          usedCredits: true,
        },
      });
      const lowCreditVendorCustomerIds = lowCreditWallets
        .filter((w) => w.totalCredits < w.usedCredits)
        .map((w) => w.vendorCustomerId);

      subConditions.push({
        vendorCustomerId: { in: lowCreditVendorCustomerIds },
      });
    }

    if (query.mealType) {
      subConditions.push({
        planVersion: {
          meals: {
            some: {
              meal: {
                name: {
                  equals: query.mealType,
                  mode: 'insensitive',
                },
              },
            },
          },
        },
      });
    }

    const customerConditions: Prisma.CustomerWhereInput[] = [];
    if (query.search) {
      const searchString = query.search.trim();
      customerConditions.push({
        OR: [
          { fullName: { contains: searchString, mode: 'insensitive' } },
          { mobileNumber: { contains: searchString, mode: 'insensitive' } },
        ],
      });
    }

    if (query.location) {
      customerConditions.push({
        address: {
          contains: query.location.trim(),
          mode: 'insensitive',
        },
      });
    }

    if (customerConditions.length > 0) {
      subConditions.push({
        vendorCustomer: {
          customer: {
            AND: customerConditions,
          },
        },
      });
    }

    if (subConditions.length > 0) {
      where.subscription = {
        AND: subConditions,
      };
    }

    // 4. Metrics aggregation (un-paginated and un-filtered by status/mealType/search, for today's totals)
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
      include: {
        subscription: {
          include: {
            vendorCustomer: {
              include: {
                wallet: true,
              },
            },
            planVersion: {
              include: {
                meals: {
                  include: {
                    meal: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    let lunchCount = 0;
    let dinnerCount = 0;
    let breakfastCount = 0;
    let lowCreditCount = 0;
    let deliveredCount = 0;
    let preparingCount = 0;

    for (const d of allTodayDeliveries) {
      if (d.status === DeliveryStatus.Delivered) {
        deliveredCount++;
      } else if (d.status === DeliveryStatus.Pending) {
        preparingCount++;
      }

      const wallet = d.subscription?.vendorCustomer?.wallet;
      if (wallet) {
        const balance = wallet.totalCredits - wallet.usedCredits;
        if (balance < 0) {
          lowCreditCount++;
        }
      }

      const planMeals = d.subscription?.planVersion?.meals || [];
      for (const pm of planMeals) {
        const mealName = pm.meal?.name?.toLowerCase();
        if (mealName === 'lunch') {
          lunchCount++;
        } else if (mealName === 'dinner') {
          dinnerCount++;
        } else if (mealName === 'breakfast') {
          breakfastCount++;
        }
      }
    }

    const metrics = {
      total: allTodayDeliveries.length,
      preparing: preparingCount,
      delivered: deliveredCount,
      lunch: lunchCount,
      dinner: dinnerCount,
      breakfast: breakfastCount,
      lowCredit: lowCreditCount,
    };

    // 5. Paginated data query
    const count = await this.prisma.mealDelivery.count({ where });
    const data = await this.prisma.mealDelivery.findMany({
      where,
      include: {
        subscription: {
          include: {
            vendorCustomer: {
              include: {
                customer: true,
                wallet: true,
              },
            },
            planVersion: {
              include: {
                plan: true,
                meals: {
                  include: {
                    meal: {
                      include: {
                        mealMeta: true,
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      skip: query.skip || 0,
      take: query.take || 10,
      orderBy: { id: 'desc' },
    });

    const formattedData = data.map((delivery) => {
      const sub = delivery.subscription;
      const vendorCustomer = sub?.vendorCustomer;
      const customer = vendorCustomer?.customer;
      const planVersion = sub?.planVersion;
      const plan = planVersion?.plan;
      const wallet = vendorCustomer?.wallet;

      // Extract meals and their delivery times
      const meals =
        planVersion?.meals?.map((pm) => {
          const meal = pm.meal;
          return {
            id: meal?.id,
            name: meal?.name,
            deliveryTime: meal?.mealMeta?.deliveryTime || null,
          };
        }) || [];

      return {
        id: delivery.id,
        deliveryDate: delivery.deliveryDate,
        status: delivery.status,
        customer: customer
          ? {
              id: customer.id,
              fullName: customer.fullName,
              mobileNumber: customer.mobileNumber,
              address: customer.address,
              status: customer.status,
            }
          : null,
        plan: planVersion
          ? {
              name: plan?.name || 'N/A',
              totalTiffins: planVersion.totalTiffins,
              meals: meals,
            }
          : null,
        wallet: wallet
          ? {
              totalCredits: wallet.totalCredits,
              usedCredits: wallet.usedCredits,
              balance: wallet.totalCredits - wallet.usedCredits,
            }
          : null,
      };
    });

    return {
      metrics,
      count,
      skip: query.skip || 0,
      take: query.take || 10,
      data: formattedData,
    };
  }

  async getById(id: number, loggedInUser: { id: number; type: UserType }) {
    const delivery = await this.prisma.mealDelivery.findUnique({
      where: { id },
      include: {
        subscription: {
          include: {
            vendor: true,
            paymentRequest: true,
            pauseRequests: {
              orderBy: { id: 'desc' },
            },
            vendorCustomer: {
              include: {
                customer: {
                  include: {
                    user: true,
                  },
                },
                wallet: true,
                refundRequests: {
                  orderBy: { id: 'desc' },
                },
              },
            },
            planVersion: {
              include: {
                plan: true,
                meals: {
                  include: {
                    meal: {
                      include: {
                        mealMeta: true,
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!delivery) {
      throw new NotFoundException(`Delivery record with ID ${id} not found`);
    }

    if (
      loggedInUser.type === UserType.Vendor &&
      delivery.subscription.vendorId !== loggedInUser.id
    ) {
      throw new ForbiddenException(
        'You do not have access to this delivery record',
      );
    }

    // Fetch DailyMenu for the delivery date and vendor
    const deliveryDate = delivery.deliveryDate;
    const startOfDay = new Date(
      deliveryDate.getFullYear(),
      deliveryDate.getMonth(),
      deliveryDate.getDate(),
    );
    const endOfDay = new Date(
      deliveryDate.getFullYear(),
      deliveryDate.getMonth(),
      deliveryDate.getDate(),
      23,
      59,
      59,
      999,
    );

    const dailyMenus = await this.prisma.dailyMenu.findMany({
      where: {
        vendorId: delivery.subscription.vendorId,
        menuDate: {
          gte: startOfDay,
          lte: endOfDay,
        },
      },
      include: {
        dishes: true,
      },
    });

    const dailyMenuData = dailyMenus.map((dm) => ({
      id: dm.id,
      mealType: dm.mealType,
      specialNote: dm.specialNote,
      dishes: dm.dishes.map((dish) => ({
        id: dish.id,
        dishName: dish.dishName,
        displayOrder: dish.displayOrder,
      })),
    }));

    const sub = delivery.subscription;
    const vendorCustomer = sub?.vendorCustomer;
    const customer = vendorCustomer?.customer;
    const planVersion = sub?.planVersion;
    const wallet = vendorCustomer?.wallet;

    const walletInfo = wallet
      ? {
          totalCredits: wallet.totalCredits,
          usedCredits: wallet.usedCredits,
          balance: wallet.totalCredits - wallet.usedCredits,
          lowCreditThreshold: wallet.lowCreditThreshold,
          criticalCreditThreshold: wallet.criticalCreditThreshold,
        }
      : null;

    const meals =
      planVersion?.meals?.map((pm) => {
        const meal = pm.meal;
        return {
          id: meal?.id,
          name: meal?.name,
          deliveryTime: meal?.mealMeta?.deliveryTime || null,
          status: delivery.status,
        };
      }) || [];

    const pr = sub?.paymentRequest;
    const paymentReqInfo = pr
      ? {
          id: pr.id,
          amount: Number(pr.amount) || 0,
          paymentMethod: pr.paymentMethod,
          transactionReference: pr.transactionReference,
          paymentProofUrl: pr.paymentProofUrl,
          paymentDate: pr.paymentDate,
          status: pr.status,
          rejectionReason: pr.rejectionReason,
        }
      : null;

    const pauseRequests =
      sub?.pauseRequests?.map((pReq) => ({
        id: pReq.id,
        startDate: pReq.startDate,
        endDate: pReq.endDate,
        status: pReq.status,
        createdAt: pReq.createdAt,
      })) || [];

    const refundRequests =
      vendorCustomer?.refundRequests?.map((rr) => ({
        id: rr.id,
        credits: rr.credits,
        amount: Number(rr.amount) || 0,
        status: rr.status,
        reason: rr.reason,
        cancellationFee: Number(rr.cancellationFee) || 0,
        processingFee: Number(rr.processingFee) || 0,
        taxDeduction: Number(rr.taxDeduction) || 0,
        rejectionReason: rr.rejectionReason,
        createdAt: rr.createdAt,
      })) || [];

    const vendor = sub?.vendor;
    const vendorInfo = vendor
      ? {
          id: vendor.id,
          fullName: vendor.fullName,
          businessName: vendor.businessName,
          dialCode: vendor.dialCode,
          mobile: vendor.mobile,
          status: vendor.status,
        }
      : null;

    return {
      id: delivery.id,
      deliveryDate: delivery.deliveryDate,
      status: delivery.status,
      createdAt: delivery.createdAt,
      updatedAt: delivery.updatedAt,
      vendor: vendorInfo,
      customer: customer
        ? {
            id: customer.id,
            fullName: customer.fullName,
            mobileNumber: customer.mobileNumber,
            email: customer.user?.email || null,
            address: customer.address,
            notes: customer.notes,
            status: customer.status,
          }
        : null,
      vendorCustomer: vendorCustomer
        ? {
            id: vendorCustomer.id,
            status: vendorCustomer.status,
            isActive: vendorCustomer.isActive,
            joinedAt: vendorCustomer.joinedAt,
            leftAt: vendorCustomer.leftAt,
            notes: vendorCustomer.notes,
          }
        : null,
      subscription: sub
        ? {
            id: sub.id,
            status: sub.status,
            startDate: sub.startDate,
            endDate: sub.endDate,
            amountPaid: Number(sub.amountPaid) || 0,
            mealsConsumed: sub.mealsConsumed,
            pauseStartDate: sub.pauseStartDate,
            pauseEndDate: sub.pauseEndDate,
            paymentRequest: paymentReqInfo,
            pauseRequests,
          }
        : null,
      plan: planVersion
        ? {
            id: planVersion.id,
            name: planVersion.plan?.name || 'N/A',
            description: planVersion.plan?.description || null,
            totalTiffins: planVersion.totalTiffins,
            meals: meals,
          }
        : null,
      wallet: walletInfo,
      refundRequests,
      dailyMenu: dailyMenuData.length > 0 ? dailyMenuData : null,
    };
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

    if (
      loggedInUser.type === UserType.Vendor &&
      delivery.subscription.vendorId !== loggedInUser.id
    ) {
      throw new ForbiddenException(
        'You do not have access to this delivery record',
      );
    }

    const vendorId =
      loggedInUser.type === UserType.Vendor
        ? loggedInUser.id
        : delivery.subscription.vendorId;

    // Use walletService to process delivery so credits/wallets are adjusted correctly
    return await this.walletService.processMealDelivery(vendorId, id, status);
  }

  async getDailyDeliveriesReport(
    query: GetDailyDeliveriesReportDto,
    loggedInUser: { id: number; type: UserType },
  ) {
    const isVendor = loggedInUser.type === UserType.Vendor;
    const targetVendorId = isVendor ? loggedInUser.id : query.vendorId;

    if (!targetVendorId) {
      throw new BadRequestException('vendorId is required');
    }

    const where: Prisma.MealDeliveryWhereInput = {};
    const subFilter: Prisma.SubscriptionWhereInput = {
      vendorId: targetVendorId,
    };

    if (query.vendorCustomerId) {
      subFilter.vendorCustomerId = query.vendorCustomerId;
    } else if (query.customerId) {
      subFilter.vendorCustomer = { customerId: query.customerId };
    }

    where.subscription = subFilter;

    // Apply date range filters on deliveries if provided
    if (query.startDate || query.endDate) {
      where.deliveryDate = {};
      if (query.startDate) {
        where.deliveryDate.gte = new Date(query.startDate);
      }
      if (query.endDate) {
        where.deliveryDate.lte = new Date(query.endDate);
      }
    }

    // Step 1: Query unique/distinct deliveryDates that match our criteria
    const uniqueDates = await this.prisma.mealDelivery.findMany({
      where,
      distinct: ['deliveryDate'],
      select: {
        deliveryDate: true,
      },
      orderBy: {
        deliveryDate: 'desc',
      },
    });

    const totalCount = uniqueDates.length;

    // Apply pagination on the dates
    const skip = query.skip || 0;
    const take = query.take || 10;
    const paginatedDates = uniqueDates.slice(skip, skip + take);

    const reportData = [];

    // Step 2: For each date, fetch delivery records and daily menus
    for (const item of paginatedDates) {
      const dateVal = item.deliveryDate;
      const startOfDay = new Date(
        dateVal.getFullYear(),
        dateVal.getMonth(),
        dateVal.getDate(),
      );
      const endOfDay = new Date(
        dateVal.getFullYear(),
        dateVal.getMonth(),
        dateVal.getDate(),
        23,
        59,
        59,
        999,
      );

      // Fetch daily menus
      const dailyMenus = await this.prisma.dailyMenu.findMany({
        where: {
          vendorId: targetVendorId,
          menuDate: {
            gte: startOfDay,
            lte: endOfDay,
          },
        },
        include: {
          dishes: true,
        },
      });

      const dailyMenuByMeal: Record<string, any> = {};
      for (const dm of dailyMenus) {
        dailyMenuByMeal[dm.mealType.toLowerCase()] = {
          id: dm.id,
          specialNote: dm.specialNote,
          dishes: dm.dishes.map((dish) => ({
            id: dish.id,
            dishName: dish.dishName,
            displayOrder: dish.displayOrder,
          })),
        };
      }

      // Fetch deliveries for this date
      const deliveries = await this.prisma.mealDelivery.findMany({
        where: {
          ...where,
          deliveryDate: {
            gte: startOfDay,
            lte: endOfDay,
          },
        },
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
                  meals: {
                    include: {
                      meal: {
                        include: {
                          mealMeta: true,
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      });

      const formattedDeliveries = deliveries.map((delivery) => {
        const sub = delivery.subscription;
        const vc = sub?.vendorCustomer;
        const cust = vc?.customer;
        const planVersion = sub?.planVersion;

        const meals =
          planVersion?.meals?.map((pm) => {
            const meal = pm.meal;
            const mealKey = meal?.name?.toLowerCase() || '';
            return {
              name: meal?.name,
              status: delivery.status,
              deliveryTime: meal?.mealMeta?.deliveryTime || null,
              dailyMenu: dailyMenuByMeal[mealKey] || null,
            };
          }) || [];

        return {
          deliveryId: delivery.id,
          planName: planVersion?.plan?.name || 'N/A',
          customer: cust
            ? {
                id: cust.id,
                fullName: cust.fullName,
                mobileNumber: cust.mobileNumber,
                address: cust.address,
              }
            : null,
          meals,
        };
      });

      reportData.push({
        date: dateVal.toISOString().split('T')[0],
        deliveries: formattedDeliveries,
      });
    }

    return {
      count: totalCount,
      skip,
      take,
      data: reportData,
    };
  }
}
