import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma';
import { MailService } from 'src/mail/mail.service';
import { SubscriptionRequestStatus } from '@prisma/client';

@Injectable()
export class SubscriptionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mailService: MailService,
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
        vendorLocation: {
          include: {
            area: true,
          },
        },
        serviceAreas: {
          include: {
            area: true,
          },
        },
        meals: {
          where: { isActive: true },
        },
      },
    });

    return vendors.map((vendor) => ({
      id: vendor.id,
      fullName: vendor.fullName,
      businessName: vendor.businessName,
      acceptingRequests: vendor.acceptingRequests,
      location: vendor.vendorLocation?.area?.name || null,
      serviceAreas: vendor.serviceAreas.map((sa) => sa.area.name),
      mealsCount: vendor.meals.length,
    }));
  }

  async getVendorProfile(vendorId: number) {
    const vendor = await this.prisma.vendor.findUnique({
      where: { id: vendorId },
      include: {
        vendorLocation: {
          include: {
            area: true,
          },
        },
        serviceAreas: {
          include: {
            area: true,
          },
        },
        meals: {
          where: { isActive: true },
          include: {
            mealPlans: {
              where: { isActive: true },
              include: {
                currentVersion: {
                  include: {
                    items: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!vendor) {
      throw new NotFoundException('Vendor not found');
    }

    return {
      id: vendor.id,
      fullName: vendor.fullName,
      businessName: vendor.businessName,
      acceptingRequests: vendor.acceptingRequests,
      location: vendor.vendorLocation?.area?.name || null,
      serviceAreas: vendor.serviceAreas.map((sa) => sa.area.name),
      meals: vendor.meals.map((m) => ({
        id: m.id,
        name: m.name,
        mealType: m.mealType,
        description: m.description,
      })),
      plans: vendor.meals.flatMap((m) =>
        m.mealPlans.map((plan) => ({
          id: plan.id,
          mealId: plan.mealId,
          mealType: m.mealType,
          name: plan.currentVersion?.name,
          description: plan.currentVersion?.description,
          price: plan.currentVersion?.price,
          totalTifin: plan.currentVersion?.totalTifin,
          items:
            plan.currentVersion?.items.map((i) => ({
              name: i.name,
              quantity: i.quantity,
            })) || [],
        })),
      ),
    };
  }



  // ==========================================
  // SUBSCRIPTION REQUESTS
  // ==========================================

  async createRequest(userId: number, planId: number, paymentProofUrl: string) {
    const plan = await this.prisma.mealPlan.findUnique({
      where: { id: planId },
      include: {
        meal: {
          include: {
            vendor: true,
          },
        },
      },
    });

    if (!plan || !plan.isActive) {
      throw new NotFoundException('Selected Meal Plan is not available');
    }

    if (!plan.meal.vendor.acceptingRequests) {
      throw new BadRequestException('This vendor is currently not accepting new subscription requests');
    }

    if (!plan.currentVersionId) {
      throw new BadRequestException('Plan version mapping is corrupted');
    }

    // SIGNUP-11/SIGNUP-12 constraint: User cannot send a second request to the same vendor while one is pending
    const pendingRequest = await this.prisma.subscriptionRequest.findFirst({
      where: {
        userId,
        vendorId: plan.meal.vendorId,
        status: SubscriptionRequestStatus.Pending,
      },
    });

    if (pendingRequest) {
      throw new BadRequestException(
        'You already have a pending subscription request for this vendor. You cannot submit another until it is approved or declined.',
      );
    }

    const request = await this.prisma.subscriptionRequest.create({
      data: {
        userId,
        vendorId: plan.meal.vendorId,
        planId,
        planVersionId: plan.currentVersionId,
        paymentProofUrl,
        status: SubscriptionRequestStatus.Pending,
      },
      include: {
        user: true,
        vendor: true,
        planVersion: true,
      },
    });

    // Notify Vendor via email
    if (plan.meal.vendor.mobile) {
      try {
        const vendorEmail = `${plan.meal.vendor.businessName.toLowerCase().replace(/\s+/g, '')}@example.com`; // Fallback template
        const userEmail = request.user.email;

        await this.mailService.send({
          to: vendorEmail,
          subject: `New Subscription Request: ${request.user.firstname} ${request.user.lastname}`,
          mailBodyOrTemplate: `
            <h3>Hello ${plan.meal.vendor.fullName}!</h3>
            <p>You have received a new subscription request from **${request.user.firstname} ${request.user.lastname}** (${userEmail}).</p>
            <p>Plan Selected: <strong>${request.planVersion.name}</strong> - Price: <strong>${request.planVersion.price} INR</strong></p>
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
        planVersion: true,
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

    // Notify the user via email
    try {
      const subject =
        status === SubscriptionRequestStatus.Accepted
          ? `Subscription APPROVED: ${request.vendor.businessName}`
          : `Subscription Declined: ${request.vendor.businessName}`;

      const content =
        status === SubscriptionRequestStatus.Accepted
          ? `<p>Congratulations! Your subscription request to **${request.vendor.businessName}** has been approved.</p>
             <p>Plan Details: <strong>${request.planVersion.name}</strong> (${request.planVersion.totalTifin} Tiffins)</p>`
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
        planVersion: true,
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
