import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from 'src/prisma';
import { MailService } from 'src/mail/mail.service';
import { SubscriptionRequestStatus } from '@prisma/client';

@Injectable()
export class SubscriptionsCron {
  private readonly logger = new Logger(SubscriptionsCron.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mailService: MailService,
  ) { }

  @Cron('0 * * * *') // Runs every hour
  async handleSubscriptionReminders() {
    this.logger.log('Running subscription request reminder cron job...');

    const now = new Date();
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const fortyEightHoursAgo = new Date(now.getTime() - 48 * 60 * 60 * 1000);

    // =========================================================================
    // 1. SIGNUP-15: Vendor reminders for pending requests older than 24 hours
    //    We find pending requests between 24h and 48h old to remind the vendor.
    // =========================================================================
    const requestsForVendorReminder = await this.prisma.subscriptionRequest.findMany({
      where: {
        status: SubscriptionRequestStatus.Pending,
        createdAt: {
          lte: twentyFourHoursAgo,
          gt: fortyEightHoursAgo,
        },
      },
      include: {
        vendor: true,
        user: true,
        planVersion: true,
      },
    });

    for (const req of requestsForVendorReminder) {
      try {
        const vendorEmail = `${req.vendor.businessName.toLowerCase().replace(/\s+/g, '')}@example.com`;
        await this.mailService.send({
          to: vendorEmail,
          subject: `URGENT Reminder: Pending Subscription Request from ${req.user.firstname}`,
          mailBodyOrTemplate: `
            <h3>Hello ${req.vendor.fullName},</h3>
            <p>This is a reminder that you have a subscription request from **${req.user.firstname} ${req.user.lastname}** that has been pending for over 24 hours.</p>
            <p>Plan: <strong>${req.planVersion.name}</strong> (${req.planVersion.price} INR)</p>
            <p>Please log in and respond to this request immediately.</p>
          `,
        });
        this.logger.log(`Sent 24h pending request reminder to Vendor ID: ${req.vendorId} for Request ID: ${req.id}`);
      } catch (err) {
        this.logger.error(`Failed to send 24h reminder to Vendor ID: ${req.vendorId}`, err);
      }
    }

    // =========================================================================
    // 2. SIGNUP-10: User notification to follow up if request is > 48 hours old
    //    We find pending requests older than 48 hours to notify the user.
    // =========================================================================
    const requestsForUserFollowUp = await this.prisma.subscriptionRequest.findMany({
      where: {
        status: SubscriptionRequestStatus.Pending,
        createdAt: {
          lte: fortyEightHoursAgo,
        },
      },
      include: {
        vendor: true,
        user: true,
      },
    });

    for (const req of requestsForUserFollowUp) {
      try {
        await this.mailService.send({
          to: req.user.email,
          subject: `Action Required: Subscription Follow-up for ${req.vendor.businessName}`,
          mailBodyOrTemplate: `
            <h3>Hello ${req.user.firstname},</h3>
            <p>It has been more than 48 hours since you sent your subscription request to **${req.vendor.businessName}**.</p>
            <p>Since the vendor has not responded yet, we encourage you to follow up directly or try contacting them.</p>
            <p>Best regards,<br>The TiffnOS Team</p>
          `,
        });
        this.logger.log(`Sent 48h no-response alert to User ID: ${req.userId} for Request ID: ${req.id}`);
      } catch (err) {
        this.logger.error(`Failed to send 48h no-response alert to User ID: ${req.userId}`, err);
      }
    }
  }
}
