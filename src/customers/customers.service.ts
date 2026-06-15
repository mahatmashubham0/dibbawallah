import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Customer, CustomerStatus, Prisma, VendorCustomerStatus } from '@prisma/client';
import { UserType } from '@Common';
import { PrismaService } from '../prisma';
import { GetCustomersQueryDto, UpdateCustomerDto, GetCustomersDueSummaryQueryDto } from './dto';

@Injectable()
export class CustomersService {
  constructor(private readonly prisma: PrismaService) { }

  async getAll(
    query: GetCustomersQueryDto,
    loggedInUser: { id: number; type: UserType },
  ): Promise<{
    count: number;
    skip: number;
    take: number;
    data: any[];
  }> {
    const isVendor = loggedInUser.type === UserType.Vendor;
    const targetVendorId = isVendor ? loggedInUser.id : query.vendorId;

    // 1. Unified payment & balance filtering if any related filter is specified
    let filteredVcIds: number[] | undefined = undefined;
    if (
      query.hasNegativeBalance !== undefined ||
      query.isDue !== undefined ||
      query.isPrepaid !== undefined ||
      query.isPartiallyPaid !== undefined
    ) {
      const conditions: string[] = [];
      
      const dueFilter = query.isDue !== undefined ? query.isDue : query.hasNegativeBalance;
      
      if (dueFilter === true) {
        conditions.push(`w."total_credits" < w."used_credits"`);
      } else if (dueFilter === false) {
        conditions.push(`(w.id IS NULL OR w."total_credits" >= w."used_credits")`);
      }
      
      if (query.isPrepaid === true) {
        conditions.push(`s."amountPaid" >= COALESCE(mpp_monthly."amount", mpp_first."amount", 0) AND (w.id IS NULL OR w."total_credits" >= w."used_credits")`);
      } else if (query.isPrepaid === false) {
        conditions.push(`(s.id IS NULL OR s."amountPaid" < COALESCE(mpp_monthly."amount", mpp_first."amount", 0) OR w."total_credits" < w."used_credits")`);
      }
      
      if (query.isPartiallyPaid === true) {
        conditions.push(`s."amountPaid" < COALESCE(mpp_monthly."amount", mpp_first."amount", 0) AND (w.id IS NULL OR w."total_credits" >= w."used_credits")`);
      } else if (query.isPartiallyPaid === false) {
        conditions.push(`(s.id IS NULL OR s."amountPaid" >= COALESCE(mpp_monthly."amount", mpp_first."amount", 0) OR w."total_credits" < w."used_credits")`);
      }
      
      const sqlWhere = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      
      const result = await this.prisma.$queryRawUnsafe<{ id: number }[]>(`
        SELECT DISTINCT vc.id FROM "VendorCustomer" vc
        LEFT JOIN "wallet" w ON w."vendor_customer_id" = vc.id
        LEFT JOIN "subscription" s ON s."vendor_customer_id" = vc.id AND s.status = 'Active'
        LEFT JOIN "meal_plan_price" mpp_monthly ON mpp_monthly."version_id" = s."plan_version_id" AND mpp_monthly."price_type" = 'monthly'
        LEFT JOIN (
          SELECT "version_id", "amount", ROW_NUMBER() OVER(PARTITION BY "version_id" ORDER BY "id") as rn
          FROM "meal_plan_price"
        ) mpp_first ON mpp_first."version_id" = s."plan_version_id" AND mpp_first.rn = 1
        ${sqlWhere}
      `);
      filteredVcIds = result.map((r) => r.id);
    }

    const where: Prisma.CustomerWhereInput = {};
    const vendorLinkConditions: Prisma.VendorCustomerWhereInput = {};
    if (targetVendorId !== undefined) {
      vendorLinkConditions.vendorId = targetVendorId;
    }
    if (query.isActive !== undefined) {
      vendorLinkConditions.isActive = query.isActive;
    }
    if (query.joinedStartDate || query.joinedEndDate) {
      vendorLinkConditions.joinedAt = {};
      if (query.joinedStartDate) {
        vendorLinkConditions.joinedAt.gte = new Date(query.joinedStartDate);
      }
      if (query.joinedEndDate) {
        vendorLinkConditions.joinedAt.lte = new Date(query.joinedEndDate);
      }
    }
    if (filteredVcIds !== undefined) {
      vendorLinkConditions.id = { in: filteredVcIds };
    }

    // 3. Subscription/Plan & Meal filters
    const subscriptionConditions: Prisma.SubscriptionWhereInput = {};
    const planVersionConditions: Prisma.MealPlanVersionWhereInput = {};

    if (query.mealPlanId !== undefined) {
      planVersionConditions.planId = query.mealPlanId;
    }
    if (query.mealType !== undefined) {
      planVersionConditions.meals = {
        some: {
          meal: {
            name: {
              equals: query.mealType,
              mode: 'insensitive',
            },
          },
        },
      };
    }

    if (Object.keys(planVersionConditions).length > 0) {
      subscriptionConditions.planVersion = planVersionConditions;
    }

    if (query.subscriptionStatus) {
      subscriptionConditions.status = query.subscriptionStatus;
    }

    if (Object.keys(subscriptionConditions).length > 0) {
      vendorLinkConditions.subscriptions = {
        some: subscriptionConditions,
      };
    }

    if (Object.keys(vendorLinkConditions).length > 0) {
      where.vendorLinks = {
        some: vendorLinkConditions,
      };
    }

    // 4. Status filtering
    if (query.status) {
      where.status = query.status;
    }

    // 5. Search filtering
    if (query.search) {
      const searchString = query.search.trim();
      where.OR = [
        {
          fullName: {
            contains: searchString,
            mode: 'insensitive',
          },
        },
        {
          mobileNumber: {
            contains: searchString,
            mode: 'insensitive',
          },
        },
      ];
    }

    const count = await this.prisma.customer.count({ where });
    const customers = await this.prisma.customer.findMany({
      where,
      include: {
        vendorLinks: {
          where: targetVendorId !== undefined ? { vendorId: targetVendorId } : undefined,
          include: {
            wallet: true,
            subscriptions: {
              include: {
                planVersion: {
                  include: {
                    plan: true,
                    prices: true,
                    meals: {
                      include: {
                        meal: true,
                      },
                    },
                  },
                },
              },
              orderBy: { id: 'desc' },
            },
          },
        },
      },
      skip: query.skip || 0,
      take: query.take || 10,
      orderBy: { id: 'desc' },
    });

    const formattedData = customers.map((customer) => {
      const link =
        customer.vendorLinks.find(
          (vl) => targetVendorId === undefined || vl.vendorId === targetVendorId,
        ) || customer.vendorLinks[0];

      let walletInfo = null;
      let subscriptionInfo = null;
      let joinedAt = customer.createdAt;

      if (link) {
        joinedAt = link.joinedAt;
        if (link.wallet) {
          walletInfo = {
            totalCredits: link.wallet.totalCredits,
            usedCredits: link.wallet.usedCredits,
            balance: link.wallet.totalCredits - link.wallet.usedCredits,
          };
        }

        const activeSub =
          link.subscriptions.find((s) => s.status === 'Active') ||
          link.subscriptions[0];

        if (activeSub) {
          const planVersion = activeSub.planVersion;
          const plan = planVersion?.plan;
          const mealsCovered =
            planVersion?.meals?.map((m) => m.meal.name) || [];

          // Calculate plan price
          const prices = planVersion?.prices || [];
          const monthlyPriceObj = prices.find((p) => p.priceType === 'Monthly');
          const planPrice = monthlyPriceObj
            ? Number(monthlyPriceObj.amount)
            : (prices[0] ? Number(prices[0].amount) : 0);

          // Calculate balance
          const balance = link.wallet
            ? link.wallet.totalCredits - link.wallet.usedCredits
            : 0;

          // Calculate per-tiffin amount
          const totalTiffins = planVersion?.totalTiffins || 0;
          const perTiffinAmount = totalTiffins > 0 ? (planPrice / totalTiffins) : 0;

          const amountPaid = Number(activeSub.amountPaid) || 0;

          let isPrepaid = false;
          let isPartiallyPaid = false;
          let isDue = false;
          let dueAmount = 0;

          if (balance < 0) {
            isDue = true;
            dueAmount = Math.round(Math.abs(balance) * perTiffinAmount * 100) / 100;
          } else {
            if (amountPaid >= planPrice) {
              isPrepaid = true;
            } else {
              isPartiallyPaid = true;
            }
          }

          subscriptionInfo = {
            id: activeSub.id,
            status: activeSub.status,
            planName: plan?.name || 'N/A',
            totalTiffins: totalTiffins,
            mealsConsumed: activeSub.mealsConsumed,
            mealsCovered,
            isPrepaid,
            isPartiallyPaid,
            isDue,
            dueAmount,
          };
        }
      }

      return {
        id: customer.id,
        fullName: customer.fullName,
        mobileNumber: customer.mobileNumber,
        address: customer.address,
        notes: customer.notes,
        status: customer.status,
        joinedAt,
        wallet: walletInfo,
        subscription: subscriptionInfo,
      };
    });

    return {
      count,
      skip: query.skip || 0,
      take: query.take || 10,
      data: formattedData,
    };
  }

  async getById(id: number, loggedInUser: { id: number; type: UserType }) {
    const customer = await this.prisma.customer.findUnique({
      where: { id },
      include: {
        user: {
          select: {
            id: true,
            firstname: true,
            lastname: true,
            email: true,
            dialCode: true,
            mobile: true,
          },
        },
        vendorLinks: {
          include: {
            vendor: {
              select: {
                id: true,
                fullName: true,
                businessName: true,
                mobile: true,
              },
            },
            wallet: true,
            subscriptions: {
              include: {
                planVersion: {
                  include: {
                    plan: true,
                    prices: true,
                  },
                },
              },
            },
            refundRequests: true,
          },
        },
      },
    });

    if (!customer) {
      throw new NotFoundException(`Customer with ID ${id} not found`);
    }

    if (loggedInUser.type === UserType.Vendor) {
      const isLinked = customer.vendorLinks.some((link) => link.vendorId === loggedInUser.id);
      if (!isLinked) {
        throw new ForbiddenException('You do not have access to this customer');
      }
      // Return only the vendor's own link
      customer.vendorLinks = customer.vendorLinks.filter((link) => link.vendorId === loggedInUser.id);
    }

    return customer;
  }

  async update(
    id: number,
    data: UpdateCustomerDto,
    loggedInUser: { id: number; type: UserType },
  ) {
    const customer = await this.prisma.customer.findUnique({
      where: { id },
      include: {
        vendorLinks: true,
      },
    });

    if (!customer) {
      throw new NotFoundException(`Customer with ID ${id} not found`);
    }

    let targetVendorId: number | undefined;
    if (loggedInUser.type === UserType.Vendor) {
      targetVendorId = loggedInUser.id;
      const hasLink = customer.vendorLinks.some((link) => link.vendorId === loggedInUser.id);
      if (!hasLink) {
        throw new ForbiddenException('You do not have access to this customer');
      }
    } else {
      targetVendorId = data.vendorId;
    }

    return this.prisma.$transaction(async (tx) => {
      // 1. Update general customer fields
      const customerUpdateData: Prisma.CustomerUpdateInput = {};
      if (data.fullName !== undefined) {
        customerUpdateData.fullName = data.fullName;
      }
      if (data.mobileNumber !== undefined) {
        customerUpdateData.mobileNumber = data.mobileNumber;
      }
      if (data.notes !== undefined) {
        customerUpdateData.notes = data.notes;
      }
      if (data.address !== undefined) {
        customerUpdateData.address = data.address;
      }
      if (data.status !== undefined) {
        customerUpdateData.status = data.status;
      }

      if (Object.keys(customerUpdateData).length > 0) {
        await tx.customer.update({
          where: { id },
          data: customerUpdateData,
        });
      }

      // 2. Update VendorCustomer relationship if relationship fields are provided
      const hasRelationshipUpdates =
        data.vendorCustomerNotes !== undefined ||
        data.vendorCustomerStatus !== undefined ||
        data.isActive !== undefined;

      if (hasRelationshipUpdates) {
        if (!targetVendorId) {
          throw new BadRequestException('vendorId is required to update vendor-customer relationship details');
        }

        const link = await tx.vendorCustomer.findUnique({
          where: {
            vendorId_customerId: {
              vendorId: targetVendorId,
              customerId: id,
            },
          },
        });

        if (!link) {
          throw new NotFoundException(`VendorCustomer link not found for vendor ${targetVendorId} and customer ${id}`);
        }

        await tx.vendorCustomer.update({
          where: { id: link.id },
          data: {
            ...(data.vendorCustomerNotes !== undefined && { notes: data.vendorCustomerNotes }),
            ...(data.vendorCustomerStatus !== undefined && { status: data.vendorCustomerStatus }),
            ...(data.isActive !== undefined && { isActive: data.isActive }),
          },
        });
      }

      // Return the updated customer details
      return this.getById(id, loggedInUser);
    });
  }

  async getDueSummary(
    query: GetCustomersDueSummaryQueryDto,
    loggedInUser: { id: number; type: UserType },
  ) {
    const isVendor = loggedInUser.type === UserType.Vendor;
    const targetVendorId = isVendor ? loggedInUser.id : query.vendorId;

    if (!targetVendorId) {
      throw new BadRequestException('vendorId is required');
    }

    // Determine date range if any
    let start: Date | undefined;
    let end: Date | undefined;

    if (query.days) {
      start = new Date();
      start.setDate(start.getDate() - query.days);
      start.setHours(0, 0, 0, 0);
      end = new Date();
    } else {
      if (query.startDate) {
        start = new Date(query.startDate);
      }
      if (query.endDate) {
        end = new Date(query.endDate);
      }
    }

    // Retrieve all vendor customers, including active subscriptions and wallet
    const vendorCustomers = await this.prisma.vendorCustomer.findMany({
      where: {
        vendorId: targetVendorId,
        wallet: {
          isNot: null,
        },
      },
      include: {
        wallet: true,
        subscriptions: {
          where: {
            status: 'Active',
          },
          include: {
            planVersion: {
              include: {
                prices: true,
              },
            },
          },
        },
      },
    });

    let totalCustomers = 0;
    let activeSubscribers = 0;
    let dueMembersCount = 0;
    let totalDueAmount = 0;

    // Default negative credit threshold (e.g. balance < 0 or balance <= minNegativeCredit)
    // If user inputs e.g. -10, threshold is -10 (which is <= -10 balance)
    const threshold = query.minNegativeCredit !== undefined ? query.minNegativeCredit : 0;

    for (const vc of vendorCustomers) {
      // 1. Filter Total Customers by date range if provided
      const joinedInRange = !start || (vc.joinedAt >= start && (!end || vc.joinedAt <= end));
      if (joinedInRange) {
        totalCustomers++;
      }

      // 2. Filter Active Subscribers by date range if provided
      const activeSub = vc.subscriptions[0];
      if (activeSub) {
        const subStartedInRange = !start || (activeSub.startDate >= start && (!end || activeSub.startDate <= end));
        if (subStartedInRange) {
          activeSubscribers++;
        }
      }

      // 3. Process outstanding dues
      if (vc.wallet) {
        const balance = vc.wallet.totalCredits - vc.wallet.usedCredits;
        const isDue = threshold === 0 ? balance < 0 : balance <= threshold;
        console.log("balance", balance, isDue)
        if (isDue) {
          // Check if due customer fits in the date range
          const dueInRange = !start || (vc.joinedAt >= start && (!end || vc.joinedAt <= end));
          if (dueInRange) {
            dueMembersCount++;

            // Calculate due amount
            if (activeSub) {
              const totalTiffins = activeSub.planVersion?.totalTiffins || 30;
              const amountPaid = Number(activeSub.amountPaid) || 0;
              const perCreditValue = totalTiffins > 0 ? (amountPaid / totalTiffins) : 0;
              const absoluteNegativeBalance = Math.abs(balance);
              totalDueAmount += absoluteNegativeBalance * perCreditValue;
            } else {
              // Fallback calculation if no active subscription exists
              totalDueAmount += Math.abs(balance) * 100;
            }
          }
        }
      }
    }

    return {
      totalCustomers,
      activeSubscribers,
      dueMembersCount,
      totalDueAmount: Math.round(totalDueAmount * 100) / 100,
    };
  }
}
