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
} from '@prisma/client';
import { WalletService } from '../wallet/wallet.service';

@Injectable()
export class SubscriptionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mailService: MailService,
    private readonly walletService: WalletService,
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
      throw new NotFoundException('Vendor with the provided invite code not found');
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
                    { normalizedName: { contains: trimmed, mode: 'insensitive' } },
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

    const locationMap = new Map(
      locations.map((loc) => [loc.ownerId, loc]),
    );

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
      plans: vendor.mealPlans.map((plan) => {
        const currentVersion = plan.currentVersion;
        if (!currentVersion) return null;
        
        const monthlyPriceObj = currentVersion.prices.find((p) => p.priceType === PriceType.Monthly);
        return {
          id: plan.id,
          name: plan.name,
          description: plan.description,
          price: monthlyPriceObj ? Number(monthlyPriceObj.amount) : (currentVersion.prices[0] ? Number(currentVersion.prices[0].amount) : 0),
          items: currentVersion.meals.map((i) => ({
            name: i.meal.name,
          })),
        };
      }).filter(Boolean),
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
          include: { prices: true }
        },
      },
    });

    if (!plan || !plan.isActive) {
      throw new NotFoundException('Selected Meal Plan is not available');
    }

    if (!plan.vendor.acceptingRequests) {
      throw new BadRequestException('This vendor is currently not accepting new subscription requests');
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
      throw new BadRequestException('Selected Meal Plan does not have an active version');
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

        const monthlyPriceObj = request.planVersion.prices.find((p) => p.priceType === PriceType.Monthly);
        const price = monthlyPriceObj ? Number(monthlyPriceObj.amount) : (request.planVersion.prices[0] ? Number(request.planVersion.prices[0].amount) : 0);

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
      throw new BadRequestException('This subscription request has already been responded to');
    }

    if (status === SubscriptionRequestStatus.Declined && !declineReason?.trim()) {
      throw new BadRequestException('A reason must be provided when declining a subscription request');
    }

    const updated = await this.prisma.subscriptionRequest.update({
      where: { id: requestId },
      data: {
        status,
        declineReason: status === SubscriptionRequestStatus.Declined ? declineReason : null,
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
        const monthlyPriceObj = plan.prices.find((p: any) => p.priceType === PriceType.Monthly);
        const price = monthlyPriceObj ? Number(monthlyPriceObj.amount) : (plan.prices[0] ? Number(plan.prices[0].amount) : 0);

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
}
