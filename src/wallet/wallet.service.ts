import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma';
import { ConfigureWalletDto, RechargeWalletDto } from './dto/wallet.dto';
import {
  DeliveryStatus,
  Prisma,
  WalletTransactionType,
  RefundStatus,
  SubscriptionStatus,
} from '@prisma/client';
import { NotificationService } from 'src/notification/notification.service';
import { NotificationTemplateKey } from 'src/notification/types/notification-template-key.enum';

@Injectable()
export class WalletService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationService: NotificationService,
  ) {}

  // ==========================================
  // CORE WALLET OPERATIONS
  // ==========================================

  async getOrCreateWallet(
    vendorCustomerId: number,
    tx?: Prisma.TransactionClient,
  ) {
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
        lowCreditThreshold:
          data.lowCreditThreshold !== undefined
            ? data.lowCreditThreshold
            : undefined,
        criticalCreditThreshold:
          data.criticalCreditThreshold !== undefined
            ? data.criticalCreditThreshold
            : undefined,
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

    // 1. TRANSACTION LOG
    await client.walletTransaction.create({
      data: {
        walletId: wallet.id,
        amount: data.credits,
        type: WalletTransactionType.Recharge,
        description: data.description ?? 'Prepaid Recharge',
      },
    });

    // 2. UPDATE WALLET
    await client.wallet.update({
      where: { id: wallet.id },
      data: {
        totalCredits: { increment: data.credits },
      },
    });

    // 3. GET VENDOR CUSTOMER (single query)
    const vc = await client.vendorCustomer.findUnique({
      where: { id: vendorCustomerId },
      select: {
        customerId: true,
        vendorId: true,
      },
    });

    return {
      walletId: wallet.id,
      addedCredits: data.credits,
      totalCredits: newTotal,
      currentCredits: newTotal - wallet.usedCredits,
    };
  }

  // MEAL DELIVERY & CONSUMPTION
  async scheduleDelivery(
    subscriptionId: number,
    deliveryDate: Date,
    deliveryTime?: string,
  ) {
    return await this.prisma.mealDelivery.create({
      data: {
        subscriptionId,
        deliveryDate,
        status: DeliveryStatus.Pending,
      },
    });
  }

  async processMealDelivery(
    vendorId: number,
    deliveryId: number,
    status: DeliveryStatus,
  ) {
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
        throw new BadRequestException(
          'This delivery record does not belong to your vendor account',
        );
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
      } else if (
        prevStatus === DeliveryStatus.Delivered &&
        (status === DeliveryStatus.Missed ||
          status === DeliveryStatus.Cancelled)
      ) {
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
            type:
              balanceChange === -1
                ? WalletTransactionType.Consumption
                : WalletTransactionType.Refund,
            description:
              balanceChange === -1
                ? `Meal consumption: Delivery #${deliveryId}`
                : `Refund for missed/cancelled delivery #${deliveryId}`,
            referenceId: deliveryId.toString(),
          },
        });

        await tx.wallet.update({
          where: { id: wallet.id },
          data: {
            usedCredits:
              balanceChange === -1 ? { increment: 1 } : { decrement: 1 },
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
      where: {
        vendorCustomerId,
        status: { in: [SubscriptionStatus.Active, SubscriptionStatus.Paused] },
      },
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

    const customerId =
      (
        await this.prisma.vendorCustomer.findUnique({
          where: { id: vendorCustomerId },
        })
      )?.customerId || 0;

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
