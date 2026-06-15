import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Customer, CustomerStatus, Prisma, VendorCustomerStatus } from '@prisma/client';
import { UserType } from '@Common';
import { PrismaService } from '../prisma';
import { GetCustomersQueryDto, UpdateCustomerDto, GetCustomersDueSummaryQueryDto, GetCustomerCalendarQueryDto, CustomerBillingDto, BillingAction } from './dto';

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
          let paymentStatus = 'Prepaid';
          let pendingAmount = 0;

          if (balance < 0) {
            isDue = true;
            dueAmount = Math.round(Math.abs(balance) * perTiffinAmount * 100) / 100;
            paymentStatus = 'Due';
            pendingAmount = dueAmount;
          } else {
            if (amountPaid >= planPrice) {
              isPrepaid = true;
              paymentStatus = 'Prepaid';
              pendingAmount = 0;
            } else {
              isPartiallyPaid = true;
              paymentStatus = 'Partially Paid';
              pendingAmount = Math.round((planPrice - amountPaid) * 100) / 100;
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
            amountPaid,
            monthlyPrice: planPrice,
            paymentStatus,
            pendingAmount,
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
                    meals: {
                      include: {
                        meal: {
                          include: {
                            mealMeta: true
                          }
                        },
                      },
                    },
                  },
                },
              },
              orderBy: { id: 'desc' },
            },
            refundRequests: {
              orderBy: { id: 'desc' },
            },
            paymentRequests: {
              include: {
                planVersion: {
                  include: {
                    plan: true,
                  },
                },
              },
              orderBy: { id: 'desc' },
            },
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

    // Format vendor links details comprehensively
    const formattedLinks = customer.vendorLinks.map((link) => {
      let walletInfo = null;
      let activeSubscriptionInfo = null;

      if (link.wallet) {
        walletInfo = {
          id: link.wallet.id,
          totalCredits: link.wallet.totalCredits,
          usedCredits: link.wallet.usedCredits,
          balance: link.wallet.totalCredits - link.wallet.usedCredits,
          createdAt: link.wallet.createdAt,
          updatedAt: link.wallet.updatedAt,
        };
      }

      // Format all subscriptions
      const formattedSubscriptions = link.subscriptions.map((sub) => {
        const planVersion = sub.planVersion;
        const plan = planVersion?.plan;
        const mealsCovered = planVersion?.meals?.map((m) => m.meal.name) || [];

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

        const amountPaid = Number(sub.amountPaid) || 0;

        let isPrepaid = false;
        let isPartiallyPaid = false;
        let isDue = false;
        let dueAmount = 0;
        let paymentStatus = 'Prepaid';
        let pendingAmount = 0;

        if (balance < 0) {
          isDue = true;
          dueAmount = Math.round(Math.abs(balance) * perTiffinAmount * 100) / 100;
          paymentStatus = 'Due';
          pendingAmount = dueAmount;
        } else {
          if (amountPaid >= planPrice) {
            isPrepaid = true;
            paymentStatus = 'Prepaid';
            pendingAmount = 0;
          } else {
            isPartiallyPaid = true;
            paymentStatus = 'Partially Paid';
            pendingAmount = Math.round((planPrice - amountPaid) * 100) / 100;
          }
        }

        return {
          id: sub.id,
          status: sub.status,
          startDate: sub.startDate,
          endDate: sub.endDate,
          pauseStartDate: sub.pauseStartDate,
          pauseEndDate: sub.pauseEndDate,
          amountPaid,
          mealsConsumed: sub.mealsConsumed,
          createdAt: sub.createdAt,
          updatedAt: sub.updatedAt,
          planDetails: {
            planId: plan?.id || null,
            planName: plan?.name || 'N/A',
            planDescription: plan?.description || '',
            totalTiffins,
            mealsCovered,
            prices: prices.map(p => ({
              priceType: p.priceType,
              amount: Number(p.amount)
            })),
          },
          isPrepaid,
          isPartiallyPaid,
          isDue,
          dueAmount,
          monthlyPrice: planPrice,
          paymentStatus,
          pendingAmount,
        };
      });

      // Find active subscription or fallback to the latest one
      // const activeSub =
      //   link.subscriptions.find((s) => s.status === 'Active') ||
      //   link.subscriptions[0];

      // if (activeSub) {
      //   activeSubscriptionInfo = formattedSubscriptions.find(s => s.id === activeSub.id) || null;
      // }

      return {
        id: link.id,
        vendorId: link.vendorId,
        vendor: link.vendor,
        status: link.status,
        isActive: link.isActive,
        joinedAt: link.joinedAt,
        leftAt: link.leftAt,
        notes: link.notes,
        wallet: walletInfo,
        activeSubscription: activeSubscriptionInfo,
        subscriptions: formattedSubscriptions,
        refundRequests: link.refundRequests,
        paymentRequests: link.paymentRequests,
      };
    });

    return {
      id: customer.id,
      fullName: customer.fullName,
      mobileNumber: customer.mobileNumber,
      address: customer.address,
      notes: customer.notes,
      status: customer.status,
      createdAt: customer.createdAt,
      updatedAt: customer.updatedAt,
      user: customer.user,
      vendorLinks: formattedLinks,
    };
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

  async getCalendarData(
    customerId: number,
    query: GetCustomerCalendarQueryDto,
    loggedInUser: { id: number; type: UserType },
  ) {
    const isVendor = loggedInUser.type === UserType.Vendor;
    const targetVendorId = isVendor ? loggedInUser.id : query.vendorId;

    if (!targetVendorId) {
      throw new BadRequestException('vendorId is required');
    }

    // 1. Verify VendorCustomer link exists
    const link = await this.prisma.vendorCustomer.findUnique({
      where: {
        vendorId_customerId: {
          vendorId: targetVendorId,
          customerId,
        },
      },
    });

    if (!link) {
      throw new NotFoundException(`Customer with ID ${customerId} is not linked to vendor ${targetVendorId}`);
    }

    // 2. Fetch all subscriptions for this customer under this vendor
    const subscriptions = await this.prisma.subscription.findMany({
      where: {
        vendorCustomerId: link.id,
      },
      select: {
        id: true,
      },
    });

    const subscriptionIds = subscriptions.map((s) => s.id);

    if (subscriptionIds.length === 0) {
      return {
        deliveries: [],
        pauseRequests: [],
      };
    }

    // Date range filters
    const deliveryDateFilter: Prisma.MealDeliveryWhereInput['deliveryDate'] = {};

    if (query.startDate) {
      deliveryDateFilter.gte = new Date(query.startDate);
    }
    if (query.endDate) {
      deliveryDateFilter.lte = new Date(query.endDate);
    }

    // 3. Fetch deliveries
    const deliveries = await this.prisma.mealDelivery.findMany({
      where: {
        subscriptionId: { in: subscriptionIds },
        ...(Object.keys(deliveryDateFilter).length > 0 && { deliveryDate: deliveryDateFilter }),
      },
      orderBy: { deliveryDate: 'asc' },
    });

    // 4. Fetch pause requests
    const pauseRequests = await this.prisma.pauseRequest.findMany({
      where: {
        subscriptionId: { in: subscriptionIds },
        ...(query.startDate && {
          endDate: { gte: new Date(query.startDate) }
        }),
        ...(query.endDate && {
          startDate: { lte: new Date(query.endDate) }
        }),
      },
      orderBy: { startDate: 'asc' },
    });

    return {
      deliveries,
      pauseRequests,
    };
  }

  async handleBilling(
    id: number,
    data: CustomerBillingDto,
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

    if (!targetVendorId) {
      throw new BadRequestException('vendorId is required');
    }

    const link = await this.prisma.vendorCustomer.findUnique({
      where: {
        vendorId_customerId: {
          vendorId: targetVendorId,
          customerId: id,
        },
      },
      include: {
        wallet: true,
        subscriptions: {
          where: { status: 'Active' },
          include: {
            planVersion: {
              include: { prices: true },
            },
          },
        },
      },
    });

    if (!link) {
      throw new NotFoundException(`VendorCustomer link not found for vendor ${targetVendorId} and customer ${id}`);
    }

    return this.prisma.$transaction(async (tx) => {
      const amount = data.amount || 0;
      let planVersion = null;

      if (data.action === BillingAction.PlanChange || data.action === BillingAction.PlanUpgrade) {
        if (!data.planVersionId) {
          throw new BadRequestException('planVersionId is required for plan change or upgrade');
        }

        planVersion = await tx.mealPlanVersion.findUnique({
          where: { id: data.planVersionId },
        });

        if (!planVersion) {
          throw new NotFoundException(`Plan version with ID ${data.planVersionId} not found`);
        }

        // Cancel existing active subscriptions
        await tx.subscription.updateMany({
          where: {
            vendorCustomerId: link.id,
            status: 'Active',
          },
          data: {
            status: 'Cancelled',
          },
        });

        // Create verified PaymentRequest
        const paymentReq = await tx.paymentRequest.create({
          data: {
            vendorCustomerId: link.id,
            vendorId: targetVendorId,
            planVersionId: data.planVersionId,
            requestType: data.action === BillingAction.PlanChange ? 'PlanChange' : 'PlanUpgrade',
            amount: amount,
            paymentMethod: 'Cash',
            status: 'Verified',
            paymentDate: new Date(),
          },
        });

        // Create new active subscription
        await tx.subscription.create({
          data: {
            vendorId: targetVendorId,
            vendorCustomerId: link.id,
            planVersionId: data.planVersionId,
            paymentRequestId: paymentReq.id,
            status: 'Active',
            startDate: new Date(),
            amountPaid: amount,
            mealsConsumed: 0,
          },
        });

        // Update Wallet
        const newTotalCredits = data.totalCredits !== undefined
          ? data.totalCredits
          : (data.credits !== undefined ? data.credits : planVersion.totalTiffins);

        const newUsedCredits = data.usedCredits !== undefined ? data.usedCredits : 0;

        if (!link.wallet) {
          await tx.wallet.create({
            data: {
              vendorCustomerId: link.id,
              totalCredits: newTotalCredits,
              usedCredits: newUsedCredits,
            },
          });
        } else {
          await tx.wallet.update({
            where: { id: link.wallet.id },
            data: {
              totalCredits: newTotalCredits,
              usedCredits: newUsedCredits,
            },
          });
        }
      } else if (data.action === BillingAction.Recharge || data.action === BillingAction.Renewal) {
        const activeSub = link.subscriptions[0];
        let planVersionId: number | undefined = activeSub?.planVersionId;

        // If no active plan, look up latest subscription planVersion
        if (!planVersionId) {
          const latestSub = await tx.subscription.findFirst({
            where: { vendorCustomerId: link.id },
            orderBy: { id: 'desc' },
          });
          planVersionId = latestSub?.planVersionId;
        }

        if (!planVersionId) {
          throw new BadRequestException('Customer has no active or past plan. Please change plan version first.');
        }

        await tx.paymentRequest.create({
          data: {
            vendorCustomerId: link.id,
            vendorId: targetVendorId,
            planVersionId: planVersionId,
            requestType: 'Renewal',
            amount: amount,
            paymentMethod: 'Cash',
            status: 'Verified',
            paymentDate: new Date(),
          },
        });

        // Compute credits to add
        let creditsToAdd = data.credits || 0;
        if (data.credits === undefined && amount > 0) {
          const prices = activeSub?.planVersion?.prices || [];
          const monthlyPriceObj = prices.find((p) => p.priceType === 'Monthly');
          const planPrice = monthlyPriceObj
            ? Number(monthlyPriceObj.amount)
            : (prices[0] ? Number(prices[0].amount) : 0);

          const totalTiffins = activeSub?.planVersion?.totalTiffins || 0;
          const perTiffinAmount = totalTiffins > 0 ? (planPrice / totalTiffins) : 0;

          if (perTiffinAmount > 0) {
            creditsToAdd = Math.round(amount / perTiffinAmount);
          } else {
            creditsToAdd = Math.round(amount / 100);
          }
        }

        if (!link.wallet) {
          await tx.wallet.create({
            data: {
              vendorCustomerId: link.id,
              totalCredits: data.totalCredits !== undefined ? data.totalCredits : creditsToAdd,
              usedCredits: data.usedCredits !== undefined ? data.usedCredits : 0,
            },
          });
        } else {
          const updatedTotalCredits = data.totalCredits !== undefined
            ? data.totalCredits
            : link.wallet.totalCredits + creditsToAdd;
          const updatedUsedCredits = data.usedCredits !== undefined
            ? data.usedCredits
            : link.wallet.usedCredits;

          await tx.wallet.update({
            where: { id: link.wallet.id },
            data: {
              totalCredits: updatedTotalCredits,
              usedCredits: updatedUsedCredits,
            },
          });
        }
      } else if (data.action === BillingAction.ManualAdjustment) {
        if (data.totalCredits === undefined && data.usedCredits === undefined) {
          throw new BadRequestException('totalCredits or usedCredits must be specified for ManualAdjustment');
        }

        if (!link.wallet) {
          await tx.wallet.create({
            data: {
              vendorCustomerId: link.id,
              totalCredits: data.totalCredits !== undefined ? data.totalCredits : 0,
              usedCredits: data.usedCredits !== undefined ? data.usedCredits : 0,
            },
          });
        } else {
          await tx.wallet.update({
            where: { id: link.wallet.id },
            data: {
              ...(data.totalCredits !== undefined && { totalCredits: data.totalCredits }),
              ...(data.usedCredits !== undefined && { usedCredits: data.usedCredits }),
            },
          });
        }
      }

      // Return updated customer details
      return this.getById(id, loggedInUser);
    });
  }
}
