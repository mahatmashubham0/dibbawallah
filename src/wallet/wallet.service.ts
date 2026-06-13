import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from 'src/prisma';
import {
  ConfigureWalletDto,
  RechargeWalletDto,
  CreateRefundRequestDto,
  ProcessRefundRequestDto,
  CreatePauseRequestDto,
} from './dto/wallet.dto';
import {
  DeliveryStatus,
  PauseRequestStatus,
  Prisma,
  RefundStatus,
  WalletTransactionType,
  SubscriptionStatus,
} from '@prisma/client';
import { NotificationService } from 'src/notification/notification.service';
import { NotificationTemplateKey } from 'src/notification/types/notification-template-key.enum';

@Injectable()
export class WalletService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationService: NotificationService,
  ) { }

  // ==========================================
  // CORE WALLET OPERATIONS
  // ==========================================

  async getOrCreateWallet(vendorCustomerId: number, tx?: Prisma.TransactionClient) {
    const client = tx || this.prisma;

    let wallet = await client.wallet.findUnique({
      where: { vendorCustomerId },
    });

    if (!wallet) {
      wallet = await client.wallet.create({
        data: {
          vendorCustomerId,
          totalCredits: 0,
          lowCreditThreshold: 5,
          criticalCreditThreshold: 2,
        },
      });
    }

    return wallet;
  }

  async configureWallet(vendorCustomerId: number, data: ConfigureWalletDto) {
    const wallet = await this.getOrCreateWallet(vendorCustomerId);

    return await this.prisma.wallet.update({
      where: { id: wallet.id },
      data: {
        lowCreditThreshold: data.lowCreditThreshold !== undefined ? data.lowCreditThreshold : undefined,
        criticalCreditThreshold: data.criticalCreditThreshold !== undefined ? data.criticalCreditThreshold : undefined,
      },
    });
  }

  async rechargeWallet(
    vendorCustomerId: number,
    data: RechargeWalletDto,
    tx?: Prisma.TransactionClient,
  ) {
    const client = tx ?? this.prisma;
    const wallet = await this.getOrCreateWallet(vendorCustomerId, client);

    const oldTotal = wallet.totalCredits;
    const newTotal = oldTotal + data.credits;

    // -------------------------
    // 1. TRANSACTION LOG
    // -------------------------
    await client.walletTransaction.create({
      data: {
        walletId: wallet.id,
        amount: data.credits,
        type: WalletTransactionType.Recharge,
        description: data.description ?? "Prepaid Recharge",
      },
    });

    // -------------------------
    // 2. UPDATE WALLET
    // -------------------------
    await client.wallet.update({
      where: { id: wallet.id },
      data: {
        totalCredits: { increment: data.credits },
      },
    });

    // -------------------------
    // 3. GET VENDOR CUSTOMER (single query)
    // -------------------------
    const vc = await client.vendorCustomer.findUnique({
      where: { id: vendorCustomerId },
      select: {
        customerId: true,
        vendorId: true,
      },
    });

    // -------------------------
    // 4. NOTIFICATION
    // -------------------------
    if (vc) {
      await this.notificationService.sendNotificationWithTemplate(
        vc.customerId,
        NotificationTemplateKey.RechargeSuccess,
        {
          credits: data.credits,
          totalCredits: newTotal,
        },
        undefined,
        vc.vendorId,
      );
    }

    return {
      walletId: wallet.id,
      addedCredits: data.credits,
      totalCredits: newTotal,
      currentCredits: newTotal - wallet.usedCredits,
    };
  }

  // ==========================================
  // MEAL DELIVERY & CONSUMPTION
  // ==========================================

  async scheduleDelivery(subscriptionId: number, deliveryDate: Date, deliveryTime?: string) {
    return await this.prisma.mealDelivery.create({
      data: {
        subscriptionId,
        deliveryDate,
        deliveryTime,
        status: DeliveryStatus.Pending,
      },
    });
  }

  async processMealDelivery(vendorId: number, deliveryId: number, status: DeliveryStatus) {
    return await this.prisma.$transaction(async (tx) => {
      const delivery = await tx.mealDelivery.findUnique({
        where: { id: deliveryId },
        include: {
          subscription: {
            include: {
              vendorCustomer: true,
            },
          },
        },
      });

      if (!delivery) {
        throw new NotFoundException('Meal delivery record not found');
      }

      if (delivery.subscription.vendorId !== vendorId) {
        throw new BadRequestException('This delivery record does not belong to your vendor account');
      }

      const prevStatus = delivery.status;
      if (prevStatus === status) {
        return delivery;
      }

      const vendorCustomerId = delivery.subscription.vendorCustomerId;
      const wallet = await this.getOrCreateWallet(vendorCustomerId, tx);
      const balance = wallet.totalCredits - wallet.usedCredits;

      let balanceChange = 0;

      // Logic for status transitions
      if (status === DeliveryStatus.Delivered) {
        // Going to Delivered means we deduct 1 credit (increment usedCredits)
        const newBalance = balance - 1;
        const creditLimit = 0; // Defaulting to 0 since creditLimit is not in schema
        if (newBalance < -creditLimit) {
          throw new BadRequestException(
            `Delivery blocked: Credit limit exceeded. Wallet Balance: ${balance}, Limit: -${creditLimit}`,
          );
        }
        balanceChange = -1;
      } else if (prevStatus === DeliveryStatus.Delivered && (status === DeliveryStatus.Missed || status === DeliveryStatus.Cancelled)) {
        // Was delivered but now cancelled/missed, refund 1 credit (decrement usedCredits)
        balanceChange = 1;
      }

      // Update delivery record status
      const updatedDelivery = await tx.mealDelivery.update({
        where: { id: deliveryId },
        data: { status },
      });

      if (balanceChange !== 0) {
        const finalBalance = balance + balanceChange;

        await tx.walletTransaction.create({
          data: {
            walletId: wallet.id,
            amount: balanceChange,
            type: balanceChange === -1 ? WalletTransactionType.Consumption : WalletTransactionType.Refund,
            description: balanceChange === -1 ? `Meal consumption: Delivery #${deliveryId}` : `Refund for missed/cancelled delivery #${deliveryId}`,
            referenceId: deliveryId.toString(),
          },
        });

        await tx.wallet.update({
          where: { id: wallet.id },
          data: {
            usedCredits: balanceChange === -1 ? { increment: 1 } : { decrement: 1 },
          },
        });

        // Trigger Notifications for customer on consumption
        if (balanceChange === -1) {
          const userId = delivery.subscription.vendorCustomer.customerId;
          if (finalBalance === wallet.lowCreditThreshold) {
            await this.notificationService.sendNotificationWithTemplate(
              userId,
              NotificationTemplateKey.LowBalance,
              { balance: finalBalance },
              undefined,
              vendorId,
            );
          } else if (finalBalance === wallet.criticalCreditThreshold) {
            await this.notificationService.sendNotificationWithTemplate(
              userId,
              NotificationTemplateKey.CriticalBalance,
              { balance: finalBalance },
              undefined,
              vendorId,
            );
          } else if (finalBalance === 0) {
            await this.notificationService.sendNotificationWithTemplate(
              userId,
              NotificationTemplateKey.ZeroBalance,
              {},
              undefined,
              vendorId,
            );
          } else if (finalBalance < 0) {
            await this.notificationService.sendNotificationWithTemplate(
              userId,
              NotificationTemplateKey.OutstandingBalance,
              { outstandingCount: Math.abs(finalBalance) },
              undefined,
              vendorId,
            );
          }
        }
      }

      return updatedDelivery;
    });
  }

  // ==========================================
  // REFUNDS & CANCELLATIONS
  // ==========================================

  async calculateRefundAmount(subscriptionId: number, creditsToRefund: number) {
    const subscription = await this.prisma.subscription.findUnique({
      where: { id: subscriptionId },
      include: {
        planVersion: true,
      },
    });

    if (!subscription) {
      throw new NotFoundException('Subscription not found');
    }

    const totalTiffins = subscription.planVersion.totalTiffins || 30; // fallback default
    const amountPaid = Number(subscription.amountPaid);
    const perCreditValue = amountPaid / totalTiffins;

    const refundAmount = creditsToRefund * perCreditValue;
    return {
      perCreditValue,
      refundAmount,
    };
  }

  async createRefundRequest(customerId: number, vendorCustomerId: number, data: CreateRefundRequestDto) {
    const vc = await this.prisma.vendorCustomer.findFirst({
      where: { id: vendorCustomerId, customerId },
    });

    if (!vc) {
      throw new BadRequestException('Invalid vendor customer connection');
    }

    if (!data.subscriptionId) {
      // Find active subscription
      const activeSub = await this.prisma.subscription.findFirst({
        where: { vendorCustomerId, status: 'Active' },
      });
      if (!activeSub) throw new NotFoundException('No active subscription found for refund request');
      data.subscriptionId = activeSub.id;
    }

    const { refundAmount } = await this.calculateRefundAmount(data.subscriptionId, data.credits);

    return await this.prisma.refundRequest.create({
      data: {
        vendorCustomerId,
        subscriptionId: data.subscriptionId,
        credits: data.credits,
        amount: refundAmount,
        status: RefundStatus.Pending,
        reason: data.reason,
      },
    });
  }

  async processRefundRequest(vendorId: number, requestId: number, data: ProcessRefundRequestDto) {
    return await this.prisma.$transaction(async (tx) => {
      const refund = await tx.refundRequest.findUnique({
        where: { id: requestId },
        include: {
          vendorCustomer: true,
        },
      });

      if (!refund) {
        throw new NotFoundException('Refund request not found');
      }

      if (refund.vendorCustomer.vendorId !== vendorId) {
        throw new BadRequestException('This refund request does not belong to your vendor account');
      }

      if (refund.status !== RefundStatus.Pending) {
        throw new BadRequestException('Refund request has already been processed');
      }

      if (data.status === RefundStatus.Rejected) {
        const updated = await tx.refundRequest.update({
          where: { id: requestId },
          data: {
            status: RefundStatus.Rejected,
            rejectionReason: data.rejectionReason || 'Rejected by vendor',
          },
        });

        // Notify user
        await this.notificationService.sendNotificationWithTemplate(
          refund.vendorCustomer.customerId,
          NotificationTemplateKey.RefundRejected,
          {
            credits: refund.credits,
            reason: data.rejectionReason || 'Rejected by vendor',
          },
          undefined,
          vendorId,
        );

        return updated;
      }

      // Approved status
      const cancellationFee = data.cancellationFee || 0;
      const processingFee = data.processingFee || 0;
      const taxDeduction = data.taxDeduction || 0;

      const grossAmount = Number(refund.amount);
      const netRefundAmount = grossAmount - cancellationFee - processingFee - taxDeduction;

      // Update refund request
      const updated = await tx.refundRequest.update({
        where: { id: requestId },
        data: {
          status: RefundStatus.Approved,
          cancellationFee,
          processingFee,
          taxDeduction,
          amount: netRefundAmount, // net amount
        },
      });

      // Deduct credits from customer wallet
      const wallet = await this.getOrCreateWallet(refund.vendorCustomerId, tx);

      await tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          amount: -refund.credits,
          type: WalletTransactionType.Refund,
          description: `Processed refund: ${refund.credits} credits. Net payout: ₹${netRefundAmount.toFixed(2)}`,
          referenceId: requestId.toString(),
        },
      });

      await tx.wallet.update({
        where: { id: wallet.id },
        data: {
          totalCredits: { decrement: refund.credits },
        },
      });

      // Notify customer
      await this.notificationService.sendNotificationWithTemplate(
        refund.vendorCustomer.customerId,
        NotificationTemplateKey.RefundApproved,
        {
          credits: refund.credits,
          amount: netRefundAmount.toFixed(2),
        },
        undefined,
        vendorId,
      );

      return updated;
    });
  }

  // ==========================================
  // PAUSE / RESUME SUBSCRIPTION
  // ==========================================

  async createPauseRequest(customerId: number, subscriptionId: number, data: CreatePauseRequestDto) {
    const subscription = await this.prisma.subscription.findFirst({
      where: {
        id: subscriptionId,
        vendorCustomer: { customerId },
      },
    });

    if (!subscription) {
      throw new NotFoundException('Subscription not found');
    }

    return await this.prisma.pauseRequest.create({
      data: {
        subscriptionId,
        startDate: data.startDate,
        endDate: data.endDate,
        status: PauseRequestStatus.Pending,
      },
    });
  }

  async processPauseRequest(vendorId: number, requestId: number, status: PauseRequestStatus) {
    return await this.prisma.$transaction(async (tx) => {
      const pause = await tx.pauseRequest.findUnique({
        where: { id: requestId },
        include: {
          subscription: {
            include: {
              vendorCustomer: true,
            },
          },
        },
      });

      if (!pause) {
        throw new NotFoundException('Pause request not found');
      }

      if (pause.subscription.vendorId !== vendorId) {
        throw new BadRequestException('This pause request does not belong to your vendor account');
      }

      if (pause.status !== PauseRequestStatus.Pending) {
        throw new BadRequestException('Pause request has already been processed');
      }

      const updatedPause = await tx.pauseRequest.update({
        where: { id: requestId },
        data: { status },
      });

      if (status === PauseRequestStatus.Approved) {
        // Set pause dates on Subscription
        await tx.subscription.update({
          where: { id: pause.subscriptionId },
          data: {
            pauseStartDate: pause.startDate,
            pauseEndDate: pause.endDate,
            status: SubscriptionStatus.Paused,
          },
        });

        // Cancel pending future deliveries within the pause interval
        await tx.mealDelivery.updateMany({
          where: {
            subscriptionId: pause.subscriptionId,
            deliveryDate: {
              gte: pause.startDate,
              lte: pause.endDate,
            },
            status: DeliveryStatus.Pending,
          },
          data: {
            status: DeliveryStatus.Cancelled,
          },
        });

        // Notify user
        await this.notificationService.sendNotificationWithTemplate(
          pause.subscription.vendorCustomer.customerId,
          NotificationTemplateKey.PauseApproved,
          {
            startDate: pause.startDate.toDateString(),
            endDate: pause.endDate.toDateString(),
          },
          undefined,
          vendorId,
        );
      }

      return updatedPause;
    });
  }

  async resumeSubscription(customerId: number, subscriptionId: number) {
    return await this.prisma.$transaction(async (tx) => {
      const subscription = await tx.subscription.findFirst({
        where: {
          id: subscriptionId,
          vendorCustomer: { customerId },
        },
        include: { vendorCustomer: true },
      });

      if (!subscription) {
        throw new NotFoundException('Subscription not found');
      }

      await tx.subscription.update({
        where: { id: subscriptionId },
        data: {
          pauseStartDate: null,
          pauseEndDate: null,
          status: SubscriptionStatus.Active,
        },
      });

      // Update active pause request to Completed
      await tx.pauseRequest.updateMany({
        where: {
          subscriptionId,
          status: PauseRequestStatus.Approved,
        },
        data: { status: PauseRequestStatus.Completed },
      });

      return { success: true };
    });
  }

  // ==========================================
  // CANCELLATION FLOW
  // ==========================================

  async cancelSubscription(vendorCustomerId: number, subscriptionId: number, raiseRefund = false) {
    return await this.prisma.$transaction(async (tx) => {
      const subscription = await tx.subscription.findUnique({
        where: { id: subscriptionId },
        include: { vendorCustomer: true, planVersion: true },
      });

      if (!subscription) {
        throw new NotFoundException('Subscription not found');
      }

      await tx.subscription.update({
        where: { id: subscriptionId },
        data: { status: SubscriptionStatus.Cancelled },
      });

      // Cancel all upcoming pending deliveries
      await tx.mealDelivery.updateMany({
        where: {
          subscriptionId,
          status: DeliveryStatus.Pending,
        },
        data: {
          status: DeliveryStatus.Cancelled,
        },
      });

      // Optionally raise refund request for remaining credits
      if (raiseRefund) {
        const wallet = await this.getOrCreateWallet(vendorCustomerId, tx);
        const balance = wallet.totalCredits - wallet.usedCredits;
        if (balance > 0) {
          const totalTiffins = subscription.planVersion.totalTiffins || 30;
          const amountPaid = Number(subscription.amountPaid);
          const perCreditValue = amountPaid / totalTiffins;
          const refundAmount = balance * perCreditValue;

          await tx.refundRequest.create({
            data: {
              vendorCustomerId,
              subscriptionId,
              credits: balance,
              amount: refundAmount,
              status: RefundStatus.Pending,
              reason: 'Subscription cancellation refund',
            },
          });
        }
      }

      // Notify customer
      await this.notificationService.sendNotificationWithTemplate(
        subscription.vendorCustomer.customerId,
        NotificationTemplateKey.CancellationApproved,
        {},
        undefined,
        subscription.vendorId,
      );

      return { success: true };
    });
  }

  // ==========================================
  // DASHBOARDS & ANALYTICS
  // ==========================================

  async getVendorDashboard(vendorId: number) {
    const activeCustomers = await this.prisma.vendorCustomer.count({
      where: { vendorId, isActive: true },
    });

    const wallets = await this.prisma.wallet.findMany({
      where: { vendorCustomer: { vendorId } },
    });

    let lowBalanceCount = 0;
    let outstandingCount = 0;

    for (const w of wallets) {
      const balance = w.totalCredits - w.usedCredits;
      if (balance < 0) {
        outstandingCount++;
      } else if (balance <= w.lowCreditThreshold) {
        lowBalanceCount++;
      }
    }

    const pendingRefunds = await this.prisma.refundRequest.count({
      where: {
        vendorCustomer: { vendorId },
        status: RefundStatus.Pending,
      },
    });

    const pausedCustomers = await this.prisma.subscription.count({
      where: { vendorId, status: SubscriptionStatus.Paused },
    });

    const cancelledCustomers = await this.prisma.subscription.count({
      where: { vendorId, status: SubscriptionStatus.Cancelled },
    });

    // Summarize deliveries
    const upcomingDeliveries = await this.prisma.mealDelivery.findMany({
      where: {
        subscription: { vendorId },
        status: DeliveryStatus.Pending,
      },
      include: {
        subscription: {
          include: {
            vendorCustomer: {
              include: { customer: true },
            },
          },
        },
      },
      take: 10,
    });

    const failedDeliveries = await this.prisma.mealDelivery.count({
      where: {
        subscription: { vendorId },
        status: DeliveryStatus.Missed,
      },
    });

    return {
      totalActiveCustomers: activeCustomers,
      customersWithLowBalance: lowBalanceCount,
      customersWithOutstandingBalance: outstandingCount,
      pendingRefundRequests: pendingRefunds,
      pausedCustomers,
      cancelledCustomers,
      upcomingDeliveries,
      failedDeliveries,
    };
  }

  async getCustomerDashboard(vendorCustomerId: number) {
    const wallet = await this.getOrCreateWallet(vendorCustomerId);
    const balance = wallet.totalCredits - wallet.usedCredits;

    const transactions = await this.prisma.walletTransaction.findMany({
      where: { walletId: wallet.id },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    const activeSubscription = await this.prisma.subscription.findFirst({
      where: { vendorCustomerId, status: { in: [SubscriptionStatus.Active, SubscriptionStatus.Paused] } },
      include: { planVersion: true },
    });

    const refundRequests = await this.prisma.refundRequest.findMany({
      where: { vendorCustomerId },
      orderBy: { createdAt: 'desc' },
    });

    const pauseRequests = await this.prisma.pauseRequest.findMany({
      where: { subscription: { vendorCustomerId } },
      orderBy: { createdAt: 'desc' },
    });

    const upcomingDeliveries = await this.prisma.mealDelivery.findMany({
      where: {
        subscription: { vendorCustomerId },
        status: DeliveryStatus.Pending,
      },
      orderBy: { deliveryDate: 'asc' },
      take: 10,
    });

    const customerId = (await this.prisma.vendorCustomer.findUnique({ where: { id: vendorCustomerId } }))?.customerId || 0;

    const notificationEvents = await this.prisma.notificationEvent.findMany({
      where: { entityId: Number(customerId) },
      orderBy: { createdAt: 'desc' },
      take: 15,
    });

    // Map NotificationEvent records back to the shape expected by the frontend client (mapping to broken Notification model structure)
    const mappedNotifications = notificationEvents.map((event) => {
      const payload = event.payload as any;
      return {
        id: event.id,
        userId: Number(event.entityId),
        vendorId: event.actorId ? Number(event.actorId) : null,
        title: payload?.title || '',
        message: payload?.body || '',
        type: event.type,
        createdAt: event.createdAt,
      };
    });

    return {
      currentWalletBalance: balance,
      outstandingBalance: balance < 0 ? Math.abs(balance) : 0,
      creditHistory: transactions,
      activeSubscription,
      refundRequests,
      pauseRequests,
      upcomingDeliveries,
      notifications: mappedNotifications,
    };
  }
}
