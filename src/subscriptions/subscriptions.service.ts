import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma';
import { MailService } from 'src/mail/mail.service';
import {
  SubscriptionRequestStatus,
  PriceType,
  PaymentMethod,
  PaymentRequestType,
  PaymentStatus,
  SubscriptionStatus,
  LocationOwnerType,
  PauseRequestStatus,
  RefundStatus,
  WalletTransactionType,
  DeliveryStatus,
  Prisma,
  BillingAction,
} from '@prisma/client';
import { WalletService } from '../wallet/wallet.service';
import {
  CreatePauseRequestDto,
  CreateRefundRequestDto,
  ProcessRefundRequestDto,
  GetPauseRequestsQueryDto,
  GetRefundRequestsQueryDto,
  GetSubscriptionLogsQueryDto,
} from './dto';
import { NotificationService } from 'src/notification/notification.service';
import { NotificationTemplateKey } from 'src/notification/types/notification-template-key.enum';
import { UserType } from '@Common';

@Injectable()
export class SubscriptionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mailService: MailService,
    private readonly walletService: WalletService,
    private readonly notificationService: NotificationService,
  ) { }

  // ==========================================
  // VENDOR DISCOVERY
  // ==========================================

  async findVendorByInviteCode(inviteCode: string) {
    const meta = await this.prisma.vendorMeta.findUnique({
      where: { inviteCode },
      select: { vendorId: true },
    });

    if (!meta) {
      throw new NotFoundException(
        'Vendor with the provided invite code not found',
      );
    }

    return this.getVendorProfile(meta.vendorId);
  }

  async searchVendors(query: string) {
    const trimmed = query.trim();
    if (!trimmed) {
      return [];
    }

    const vendors = await this.prisma.vendor.findMany({
      where: {
        status: 'Active',
        OR: [
          { fullName: { contains: trimmed, mode: 'insensitive' } },
          { businessName: { contains: trimmed, mode: 'insensitive' } },
          {
            serviceAreas: {
              some: {
                area: {
                  OR: [
                    { name: { contains: trimmed, mode: 'insensitive' } },
                    {
                      normalizedName: {
                        contains: trimmed,
                        mode: 'insensitive',
                      },
                    },
                    { pincode: { contains: trimmed } },
                  ],
                },
              },
            },
          },
        ],
      },
      include: {
        serviceAreas: {
          include: {
            area: true,
          },
        },
        mealPlans: {
          where: { isActive: true },
        },
      },
    });

    const vendorIds = vendors.map((v) => v.id);
    const locations = await this.prisma.location.findMany({
      where: {
        ownerId: { in: vendorIds },
        ownerType: LocationOwnerType.Vendor,
      },
      include: {
        area: true,
      },
    });

    const locationMap = new Map(locations.map((loc) => [loc.ownerId, loc]));

    return vendors.map((vendor) => {
      const vendorLoc = locationMap.get(vendor.id);
      return {
        id: vendor.id,
        fullName: vendor.fullName,
        businessName: vendor.businessName,
        acceptingRequests: vendor.acceptingRequests,
        location: vendorLoc?.area?.name || null,
        serviceAreas: vendor.serviceAreas.map((sa) => sa.area.name),
        plansCount: vendor.mealPlans.length,
      };
    });
  }

  async getVendorProfile(vendorId: number) {
    const vendor = await this.prisma.vendor.findUnique({
      where: { id: vendorId },
      include: {
        serviceAreas: {
          include: {
            area: true,
          },
        },
        mealPlans: {
          where: { isActive: true },
          include: {
            currentVersion: {
              include: {
                meals: { include: { meal: true } },
                prices: true,
              },
            },
          },
        },
      },
    });

    if (!vendor) {
      throw new NotFoundException('Vendor not found');
    }

    const vendorLoc = await this.prisma.location.findFirst({
      where: {
        ownerId: vendorId,
        ownerType: LocationOwnerType.Vendor,
      },
      include: {
        area: true,
      },
    });

    return {
      id: vendor.id,
      fullName: vendor.fullName,
      businessName: vendor.businessName,
      acceptingRequests: vendor.acceptingRequests,
      location: vendorLoc?.area?.name || null,
      serviceAreas: vendor.serviceAreas.map((sa) => sa.area.name),
      plans: vendor.mealPlans
        .map((plan) => {
          const currentVersion = plan.currentVersion;
          if (!currentVersion) return null;

          const monthlyPriceObj = currentVersion.prices.find(
            (p) => p.priceType === PriceType.Monthly,
          );
          return {
            id: plan.id,
            name: plan.name,
            description: plan.description,
            price: monthlyPriceObj
              ? Number(monthlyPriceObj.amount)
              : currentVersion.prices[0]
                ? Number(currentVersion.prices[0].amount)
                : 0,
            items: currentVersion.meals.map((i) => ({
              name: i.meal.name,
            })),
          };
        })
        .filter(Boolean),
    };
  }

  // ==========================================
  // SUBSCRIPTION REQUESTS
  // ==========================================

  async createRequest(userId: number, planId: number, paymentProofUrl: string) {
    const plan = await this.prisma.mealPlan.findUnique({
      where: { id: planId },
      include: {
        vendor: true,
        currentVersion: {
          include: { prices: true },
        },
      },
    });

    if (!plan || !plan.isActive) {
      throw new NotFoundException('Selected Meal Plan is not available');
    }

    if (!plan.vendor.acceptingRequests) {
      throw new BadRequestException(
        'This vendor is currently not accepting new subscription requests',
      );
    }

    // SIGNUP-11/SIGNUP-12 constraint: User cannot send a second request to the same vendor while one is pending
    const pendingRequest = await this.prisma.subscriptionRequest.findFirst({
      where: {
        userId,
        vendorId: plan.vendorId,
        status: SubscriptionRequestStatus.Pending,
      },
    });

    if (pendingRequest) {
      throw new BadRequestException(
        'You already have a pending subscription request for this vendor. You cannot submit another until it is approved or declined.',
      );
    }

    if (!plan.currentVersionId) {
      throw new BadRequestException(
        'Selected Meal Plan does not have an active version',
      );
    }

    const request = await this.prisma.subscriptionRequest.create({
      data: {
        userId,
        vendorId: plan.vendorId,
        planVersionId: plan.currentVersionId,
        paymentProofUrl,
        status: SubscriptionRequestStatus.Pending,
      },
      include: {
        user: true,
        vendor: true,
        planVersion: { include: { plan: true, prices: true } },
      },
    });

    // Notify Vendor via email
    if (plan.vendor.mobile) {
      try {
        const vendorEmail = `${plan.vendor.businessName.toLowerCase().replace(/\s+/g, '')}@example.com`; // Fallback template
        const userEmail = request.user.email;

        const monthlyPriceObj = request.planVersion.prices.find(
          (p) => p.priceType === PriceType.Monthly,
        );
        const price = monthlyPriceObj
          ? Number(monthlyPriceObj.amount)
          : request.planVersion.prices[0]
            ? Number(request.planVersion.prices[0].amount)
            : 0;

        await this.mailService.send({
          to: vendorEmail,
          subject: `New Subscription Request: ${request.user.firstname} ${request.user.lastname}`,
          mailBodyOrTemplate: `
            <h3>Hello ${plan.vendor.fullName}!</h3>
            <p>You have received a new subscription request from **${request.user.firstname} ${request.user.lastname}** (${userEmail}).</p>
            <p>Plan Selected: <strong>${request.planVersion.plan.name}</strong> - Price: <strong>${price} INR</strong></p>
            <p>Please review and accept/decline the request in your Vendor Panel.</p>
          `,
        });
      } catch (err) {
        // Suppress notification errors so that request creation doesn't fail
      }
    }

    return request;
  }

  async respondToRequest(
    vendorId: number,
    requestId: number,
    status: SubscriptionRequestStatus,
    declineReason?: string,
  ) {
    const request = await this.prisma.subscriptionRequest.findFirst({
      where: { id: requestId, vendorId },
      include: {
        user: true,
        vendor: true,
        planVersion: { include: { plan: true, prices: true } },
      },
    });

    if (!request) {
      throw new NotFoundException('Subscription request not found');
    }

    if (request.status !== SubscriptionRequestStatus.Pending) {
      throw new BadRequestException(
        'This subscription request has already been responded to',
      );
    }

    if (
      status === SubscriptionRequestStatus.Declined &&
      !declineReason?.trim()
    ) {
      throw new BadRequestException(
        'A reason must be provided when declining a subscription request',
      );
    }

    const updated = await this.prisma.subscriptionRequest.update({
      where: { id: requestId },
      data: {
        status,
        declineReason:
          status === SubscriptionRequestStatus.Declined ? declineReason : null,
        vendorRespondedAt: new Date(),
      },
    });

    if (status === SubscriptionRequestStatus.Accepted) {
      await this.prisma.$transaction(async (tx) => {
        let vendorCustomer = await tx.vendorCustomer.findFirst({
          where: {
            vendorId: request.vendorId,
            customerId: request.userId,
          },
        });

        if (!vendorCustomer) {
          vendorCustomer = await tx.vendorCustomer.create({
            data: {
              vendorId: request.vendorId,
              customerId: request.userId,
              isActive: true,
            },
          });
        }

        const plan = request.planVersion;
        const monthlyPriceObj = plan.prices.find(
          (p: any) => p.priceType === PriceType.Monthly,
        );
        const price = monthlyPriceObj
          ? Number(monthlyPriceObj.amount)
          : plan.prices[0]
            ? Number(plan.prices[0].amount)
            : 0;

        const paymentRequest = await tx.paymentRequest.create({
          data: {
            vendorCustomerId: vendorCustomer.id,
            vendorId: request.vendorId,
            planVersionId: plan.id,
            requestType: PaymentRequestType.NewSubscription,
            amount: price,
            paymentMethod: PaymentMethod.UPI,
            paymentProofUrl: request.paymentProofUrl,
            status: PaymentStatus.Verified,
          },
        });

        const sub = await tx.subscription.create({
          data: {
            vendorId: request.vendorId,
            paymentRequestId: paymentRequest.id,
            planVersionId: plan.id,
            vendorCustomerId: vendorCustomer.id,
            status: SubscriptionStatus.Active,
            startDate: new Date(),
            amountPaid: price,
            mealsConsumed: 0,
          },
        });

        const totalTiffins = plan.totalTiffins || 30;
        await this.walletService.rechargeWallet(
          vendorCustomer.id,
          {
            credits: totalTiffins,
            amount: price,
            description: `Initial credits from plan: ${plan.plan.name}`,
          },
          tx,
        );

        // Schedule first delivery
        await this.walletService.scheduleDelivery(sub.id, new Date(), 'Lunch');
      });
    }

    // Notify the user via email
    try {
      const subject =
        status === SubscriptionRequestStatus.Accepted
          ? `Subscription APPROVED: ${request.vendor.businessName}`
          : `Subscription Declined: ${request.vendor.businessName}`;

      const content =
        status === SubscriptionRequestStatus.Accepted
          ? `<p>Congratulations! Your subscription request to **${request.vendor.businessName}** has been approved.</p>
             <p>Plan Details: <strong>${request.planVersion.plan.name}</strong></p>`
          : `<p>We regret to inform you that your subscription request to **${request.vendor.businessName}** has been declined.</p>
             <p><strong>Reason provided:</strong> ${declineReason}</p>
             <p>You can now submit a fresh request with corrected details or select a different plan.</p>`;

      await this.mailService.send({
        to: request.user.email,
        subject,
        mailBodyOrTemplate: `
          <h3>Hello ${request.user.firstname}!</h3>
          ${content}
          <p>Best regards,<br>The TiffnOS Team</p>
        `,
      });
    } catch (err) {
      // Suppress notification errors so that operation succeeds
    }

    return updated;
  }

  async getPendingRequests(vendorId: number) {
    return this.prisma.subscriptionRequest.findMany({
      where: {
        vendorId,
        status: SubscriptionRequestStatus.Pending,
      },
      include: {
        user: {
          select: {
            id: true,
            firstname: true,
            lastname: true,
            email: true,
            mobile: true,
          },
        },
        planVersion: { include: { plan: true } },
      },
    });
  }

  async getPaymentProof(vendorId: number, requestId: number) {
    const request = await this.prisma.subscriptionRequest.findFirst({
      where: { id: requestId, vendorId },
      select: {
        id: true,
        paymentProofUrl: true,
        status: true,
      },
    });

    if (!request) {
      throw new NotFoundException('Subscription request not found');
    }

    return request;
  }

  async toggleVendorAcceptance(vendorId: number, accepting: boolean) {
    return this.prisma.vendor.update({
      where: { id: vendorId },
      data: {
        acceptingRequests: accepting,
      },
      select: {
        id: true,
        acceptingRequests: true,
      },
    });
  }

  // ==========================================
  // SUBSCRIPTION PAUSE, REFUND & CANCELLATION OPERATIONS
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

  async createRefundRequest(
    loggedInUser: { id: number; type: UserType },
    vendorCustomerId: number,
    data: CreateRefundRequestDto,
  ) {
    const isVendor = loggedInUser.type === UserType.Vendor;
    const vc = await this.prisma.vendorCustomer.findFirst({
      where: {
        id: vendorCustomerId,
        ...(isVendor
          ? { vendorId: loggedInUser.id }
          : { customerId: loggedInUser.id }),
      },
    });

    if (!vc) {
      throw new BadRequestException('Invalid vendor customer connection');
    }

    return await this.prisma.$transaction(async (tx) => {
      let subscriptionId = data.subscriptionId;

      if (!subscriptionId) {
        // Find active subscription
        const activeSub = await tx.subscription.findFirst({
          where: { vendorCustomerId, status: SubscriptionStatus.Active },
        });
        if (!activeSub) {
          throw new NotFoundException(
            'No active subscription found for refund request',
          );
        }
        subscriptionId = activeSub.id;
      }

      // Automatically calculate the remaining credits
      const wallet = await this.walletService.getOrCreateWallet(
        vendorCustomerId,
        tx,
      );
      const credits = Math.max(0, wallet.totalCredits - wallet.usedCredits);

      // Based on credits and plan per-tiffin price, calculate the refund amount
      const subscription = await tx.subscription.findUnique({
        where: { id: subscriptionId },
        include: { planVersion: true },
      });

      if (!subscription) {
        throw new NotFoundException('Subscription not found');
      }

      const totalTiffins = subscription.planVersion.totalTiffins || 30;
      const amountPaid = Number(subscription.amountPaid);
      const perCreditValue = amountPaid / totalTiffins;
      const refundAmount = credits * perCreditValue;

      // Update the subscription status to Cancelled
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

      if (isVendor) {
        // If vendor creates, we auto-approve it immediately
        const refund = await tx.refundRequest.create({
          data: {
            vendorCustomerId,
            subscriptionId,
            credits,
            amount: refundAmount,
            status: RefundStatus.Approved,
            reason: data.reason,
          },
        });

        // Deduct credits from customer wallet using WalletService helper
        if (credits > 0) {
          await tx.walletTransaction.create({
            data: {
              walletId: wallet.id,
              amount: -credits,
              type: WalletTransactionType.Refund,
              description: `Processed refund: ${credits} credits. Net payout: ₹${refundAmount.toFixed(2)}`,
              referenceId: refund.id.toString(),
            },
          });

          await tx.wallet.update({
            where: { id: wallet.id },
            data: {
              totalCredits: { decrement: credits },
            },
          });
        }

        // Log SubscriptionLog
        await tx.subscriptionLog.create({
          data: {
            vendorCustomerId,
            actionType: 'RefundApproved', // Refund Completed
            amount: refundAmount,
            oldPlanVersionId: subscription.planVersionId,
            newPlanVersionId: subscription.planVersionId,
            remarks: `Refund request created and approved by vendor: Deducted ${credits} credits. Net Refund: ₹${refundAmount.toFixed(2)}. Subscription Cancelled.`,
            createdBy: loggedInUser.id,
          },
        });

        // Notify customer
        // await this.notificationService.sendNotificationWithTemplate(
        //   vc.customerId,
        //   NotificationTemplateKey.RefundApproved,
        //   {
        //     credits,
        //     amount: refundAmount.toFixed(2),
        //   },
        //   undefined,
        //   loggedInUser.id,
        // );

        return refund;
      } else {
        // Normal flow for customer (creates as Pending)
        const refund = await tx.refundRequest.create({
          data: {
            vendorCustomerId,
            subscriptionId,
            credits,
            amount: refundAmount,
            status: RefundStatus.Pending,
            reason: data.reason,
          },
        });

        // Log SubscriptionLog
        await tx.subscriptionLog.create({
          data: {
            vendorCustomerId,
            actionType: 'RefundCreated',
            amount: refundAmount,
            oldPlanVersionId: subscription.planVersionId,
            newPlanVersionId: subscription.planVersionId,
            remarks: `Refund requested for ${credits} credits. Reason: ${data.reason || 'N/A'}. Subscription Cancelled.`,
            createdBy: loggedInUser.id,
          },
        });

        return refund;
      }
    });
  }

  async processRefundRequest(
    vendorId: number,
    requestId: number,
    data: ProcessRefundRequestDto,
  ) {
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
        throw new BadRequestException(
          'This refund request does not belong to your vendor account',
        );
      }

      if (refund.status !== RefundStatus.Pending) {
        throw new BadRequestException(
          'Refund request has already been processed',
        );
      }

      const subscription = refund.subscriptionId
        ? await tx.subscription.findUnique({
          where: { id: refund.subscriptionId },
        })
        : null;

      if (data.status === RefundStatus.Rejected) {
        const updated = await tx.refundRequest.update({
          where: { id: requestId },
          data: {
            status: RefundStatus.Rejected,
            rejectionReason: data.rejectionReason || 'Rejected by vendor',
          },
        });

        // Log SubscriptionLog
        await tx.subscriptionLog.create({
          data: {
            vendorCustomerId: refund.vendorCustomerId,
            actionType: 'RefundRejected',
            amount: refund.amount,
            oldPlanVersionId: subscription?.planVersionId,
            newPlanVersionId: subscription?.planVersionId,
            remarks: `Refund request of ${refund.credits} credits rejected. Reason: ${data.rejectionReason || 'N/A'}`,
            createdBy: vendorId,
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
      const netRefundAmount =
        grossAmount - cancellationFee - processingFee - taxDeduction;

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

      // Deduct credits from customer wallet using WalletService helper
      const wallet = await this.walletService.getOrCreateWallet(
        refund.vendorCustomerId,
        tx,
      );

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

      // Log SubscriptionLog
      await tx.subscriptionLog.create({
        data: {
          vendorCustomerId: refund.vendorCustomerId,
          actionType: 'RefundApproved', // Refund Completed
          amount: netRefundAmount,
          oldPlanVersionId: subscription?.planVersionId,
          newPlanVersionId: subscription?.planVersionId,
          remarks: `Refund request approved: Deducted ${refund.credits} credits. Net Refund: ₹${netRefundAmount.toFixed(2)}`,
          createdBy: vendorId,
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

  async createPauseRequest(
    loggedInUser: { id: number; type: UserType },
    subscriptionId: number,
    data: CreatePauseRequestDto,
  ) {
    const isVendor = loggedInUser.type === UserType.Vendor;
    const subscription = await this.prisma.subscription.findFirst({
      where: {
        id: subscriptionId,
        ...(isVendor
          ? { vendorId: loggedInUser.id }
          : { vendorCustomer: { customerId: loggedInUser.id } }),
      },
    });

    if (!subscription) {
      throw new NotFoundException('Subscription not found');
    }

    // Check for existing active or pending pause requests
    const existingActivePause = await this.prisma.pauseRequest.findFirst({
      where: {
        subscriptionId,
        status: {
          in: [PauseRequestStatus.Approved],
        },
      },
    });

    if (existingActivePause) {
      throw new BadRequestException(
        'An approved active pause request already exists for this subscription',
      );
    }

    const startDateInput = new Date(data.startDate);
    const endDateInput = new Date(data.endDate);

    const startDate = new Date(
      Date.UTC(
        startDateInput.getUTCFullYear(),
        startDateInput.getUTCMonth(),
        startDateInput.getUTCDate() - 1,
        18,
        30,
        0,
        0,
      ),
    );

    const endDate = new Date(
      Date.UTC(
        endDateInput.getUTCFullYear(),
        endDateInput.getUTCMonth(),
        endDateInput.getUTCDate(),
        18,
        29,
        59,
        999,
      ),
    );

    if (startDate > endDate) {
      throw new BadRequestException('Start date cannot be after end date');
    }

    if (isVendor) {
      // If vendor creates, we auto-approve it immediately in a transaction
      return await this.prisma.$transaction(async (tx) => {
        const pause = await tx.pauseRequest.create({
          data: {
            subscriptionId,
            startDate,
            endDate,
            status: PauseRequestStatus.Approved,
            remark: data.remark,
          },
        });

        // Set pause dates on Subscription
        await tx.subscription.update({
          where: { id: subscriptionId },
          data: {
            pauseStartDate: startDate,
            pauseEndDate: endDate,
            status: SubscriptionStatus.Paused,
          },
        });

        // Cancel pending future deliveries within the pause interval
        await tx.mealDelivery.updateMany({
          where: {
            subscriptionId: pause.subscriptionId,
            deliveryDate: {
              gte: startDate,
              lte: endDate,
            },
            status: DeliveryStatus.Pending,
          },
          data: {
            status: DeliveryStatus.Cancelled,
          },
        });

        // Log SubscriptionLog
        await tx.subscriptionLog.create({
          data: {
            vendorCustomerId: subscription.vendorCustomerId,
            actionType: 'PauseApproved',
            oldPlanVersionId: subscription.planVersionId,
            newPlanVersionId: subscription.planVersionId,
            remarks: `Pause request created and approved by vendor: ${startDate.toDateString()} to ${endDate.toDateString()}`,
            createdBy: loggedInUser.id,
          },
        });

        return pause;
      });
    } else {
      // Normal flow for customer (creates as Pending)
      const pause = await this.prisma.pauseRequest.create({
        data: {
          subscriptionId,
          startDate,
          endDate,
          status: PauseRequestStatus.Pending,
          remark: data.remark,
        },
      });

      // Log SubscriptionLog
      await this.prisma.subscriptionLog.create({
        data: {
          vendorCustomerId: subscription.vendorCustomerId,
          actionType: 'PauseCreated',
          oldPlanVersionId: subscription.planVersionId,
          newPlanVersionId: subscription.planVersionId,
          remarks: `Pause requested from ${startDate.toDateString()} to ${endDate.toDateString()}`,
          createdBy: loggedInUser.id,
        },
      });

      return pause;
    }
  }

  async processPauseRequest(
    vendorId: number,
    requestId: number,
    status: PauseRequestStatus,
  ) {
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
        throw new BadRequestException(
          'This pause request does not belong to your vendor account',
        );
      }

      if (pause.status !== PauseRequestStatus.Pending) {
        throw new BadRequestException(
          'Pause request has already been processed',
        );
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

        // Log SubscriptionLog
        await tx.subscriptionLog.create({
          data: {
            vendorCustomerId: pause.subscription.vendorCustomerId,
            actionType: 'PauseApproved',
            oldPlanVersionId: pause.subscription.planVersionId,
            newPlanVersionId: pause.subscription.planVersionId,
            remarks: `Pause request approved by vendor: ${pause.startDate.toDateString()} to ${pause.endDate.toDateString()}`,
            createdBy: vendorId,
          },
        });

        // Notify user
        // await this.notificationService.sendNotificationWithTemplate(
        //   pause.subscription.vendorCustomer.customerId,
        //   NotificationTemplateKey.PauseApproved,
        //   {
        //     startDate: pause.startDate.toDateString(),
        //     endDate: pause.endDate.toDateString(),
        //   },
        //   undefined,
        //   vendorId,
        // );
      } else if (status === PauseRequestStatus.Rejected) {
        // Log SubscriptionLog
        await tx.subscriptionLog.create({
          data: {
            vendorCustomerId: pause.subscription.vendorCustomerId,
            actionType: 'PauseRejected',
            oldPlanVersionId: pause.subscription.planVersionId,
            newPlanVersionId: pause.subscription.planVersionId,
            remarks: `Pause request rejected by vendor: ${pause.startDate.toDateString()} to ${pause.endDate.toDateString()}`,
            createdBy: vendorId,
          },
        });
      }

      return updatedPause;
    });
  }

  async resumeSubscription(
    loggedInUser: { id: number; type: UserType },
    subscriptionId: number,
  ) {
    const isVendor = loggedInUser.type === UserType.Vendor;
    return await this.prisma.$transaction(async (tx) => {
      const subscription = await tx.subscription.findFirst({
        where: {
          id: subscriptionId,
          ...(isVendor
            ? { vendorId: loggedInUser.id }
            : { vendorCustomer: { customerId: loggedInUser.id } }),
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

      // Log SubscriptionLog
      await tx.subscriptionLog.create({
        data: {
          vendorCustomerId: subscription.vendorCustomerId,
          actionType: 'PauseCompleted', // Pause Over
          oldPlanVersionId: subscription.planVersionId,
          newPlanVersionId: subscription.planVersionId,
          remarks: `Subscription resumed (pause ended) by ${isVendor ? 'vendor' : 'customer'}.`,
          createdBy: loggedInUser.id,
        },
      });

      return { success: true };
    });
  }

  async cancelSubscription(
    vendorCustomerId: number,
    subscriptionId: number,
    raiseRefund = false,
  ) {
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
      let refundDetailStr = 'No refund requested.';
      if (raiseRefund) {
        const wallet = await this.walletService.getOrCreateWallet(
          vendorCustomerId,
          tx,
        );
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
          refundDetailStr = `Raised refund request for remaining ${balance} credits (₹${refundAmount.toFixed(2)}).`;
        }
      }

      // Log SubscriptionLog
      await tx.subscriptionLog.create({
        data: {
          vendorCustomerId,
          actionType: 'SubscriptionCancelled',
          oldPlanVersionId: subscription.planVersionId,
          newPlanVersionId: subscription.planVersionId,
          remarks: `Subscription cancelled. ${refundDetailStr}`,
          createdBy: subscription.vendorCustomer.customerId,
        },
      });

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

  async getPauseRequests(vendorId: number, query: GetPauseRequestsQueryDto) {
    const skip = query.skip || 0;
    const take = query.take || 10;
    const where: Prisma.PauseRequestWhereInput = {
      subscription: {
        vendorId,
      },
      ...(query.status && { status: query.status }),
    };

    const count = await this.prisma.pauseRequest.count({ where });
    const data = await this.prisma.pauseRequest.findMany({
      where,
      include: {
        subscription: {
          include: {
            vendorCustomer: {
              include: {
                customer: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    });

    return { count, skip, take, data };
  }

  async getRefundRequests(vendorId: number, query: GetRefundRequestsQueryDto) {
    const skip = query.skip || 0;
    const take = query.take || 10;
    const where: Prisma.RefundRequestWhereInput = {
      vendorCustomer: {
        vendorId,
      },
      ...(query.status && { status: query.status }),
    };

    const count = await this.prisma.refundRequest.count({ where });
    const data = await this.prisma.refundRequest.findMany({
      where,
      include: {
        vendorCustomer: {
          include: {
            customer: true,
          },
        },
        subscription: true,
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    });

    return { count, skip, take, data };
  }

  async getSubscriptionLogs(
    loggedInUser: { id: number; type: UserType },
    query: GetSubscriptionLogsQueryDto,
  ) {
    const isVendor = loggedInUser.type === UserType.Vendor;
    const isUser = loggedInUser.type === UserType.User;

    const where: Prisma.SubscriptionLogWhereInput = {};

    // Scope to target customer or vendor
    if (isVendor) {
      if (query.vendorCustomerId) {
        // Verify ownership
        const vc = await this.prisma.vendorCustomer.findFirst({
          where: { id: query.vendorCustomerId, vendorId: loggedInUser.id },
        });
        if (!vc) {
          throw new ForbiddenException('Access denied to this vendor-customer link.');
        }
        where.vendorCustomerId = query.vendorCustomerId;
      } else {
        where.vendorCustomer = { vendorId: loggedInUser.id };
      }
    } else if (isUser) {
      if (query.vendorCustomerId) {
        // Verify customer ownership
        const vc = await this.prisma.vendorCustomer.findFirst({
          where: { id: query.vendorCustomerId, customerId: loggedInUser.id },
        });
        if (!vc) {
          throw new ForbiddenException('Access denied to this customer logs.');
        }
        where.vendorCustomerId = query.vendorCustomerId;
      } else {
        where.vendorCustomer = { customerId: loggedInUser.id };
      }
    } else {
      // Admin/System
      if (query.vendorCustomerId) {
        where.vendorCustomerId = query.vendorCustomerId;
      } else if (query.vendorId) {
        where.vendorCustomer = { vendorId: query.vendorId };
      }
    }

    // Filter by categories of logs (refund, pause, billing)
    if (query.category && query.category !== 'all') {
      let actions: BillingAction[] = [];
      if (query.category === 'refund') {
        actions = [
          BillingAction.RefundCreated,
          BillingAction.RefundApproved,
          BillingAction.RefundRejected,
        ];
      } else if (query.category === 'pause') {
        actions = [
          BillingAction.PauseCreated,
          BillingAction.PauseApproved,
          BillingAction.PauseRejected,
          BillingAction.PauseCompleted,
        ];
      } else if (query.category === 'billing') {
        actions = [
          BillingAction.PlanChange,
          BillingAction.PlanUpgrade,
          BillingAction.Recharge,
          BillingAction.Renewal,
          BillingAction.ManualAdjustment,
          BillingAction.SubscriptionCancelled,
        ];
      }
      where.actionType = { in: actions };
    }

    const skip = query.skip || 0;
    const take = query.take || 10;

    const count = await this.prisma.subscriptionLog.count({ where });
    const data = await this.prisma.subscriptionLog.findMany({
      where,
      include: {
        vendorCustomer: {
          include: {
            customer: {
              select: {
                id: true,
                fullName: true,
                mobileNumber: true,
              },
            },
          },
        },
      },
      orderBy: { id: 'desc' },
      skip,
      take,
    });

    return {
      count,
      skip,
      take,
      data,
    };
  }
}
