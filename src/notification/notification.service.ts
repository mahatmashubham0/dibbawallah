import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from 'src/prisma';
import { App, cert, initializeApp, getApps } from 'firebase-admin/app';
import { getMessaging, MulticastMessage } from 'firebase-admin/messaging';
import { RegisterTokenDto } from './dto/notification.dto';
import { NotificationTemplateKey } from './types/notification-template-key.enum';
import { NotificationTemplateService } from './notification-template.service';

@Injectable()
export class NotificationService implements OnModuleInit {
  private readonly logger = new Logger(NotificationService.name);
  private firebaseApp?: App;
  private isMockMode = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly notificationTemplateService: NotificationTemplateService,
  ) { }

  onModuleInit() {
    this.initializeFirebase();
  }

  private initializeFirebase() {
    const projectId = this.configService.get<string>('firebase.projectId');
    const clientEmail = this.configService.get<string>('firebase.clientEmail');
    let privateKey = this.configService.get<string>('firebase.privateKey');
    const credentialsPath = this.configService.get<string>('firebase.credentialsPath');

    try {
      const apps = getApps();
      if (apps.length > 0) {
        this.firebaseApp = apps[0];
        this.logger.log('Firebase Admin SDK already initialized.');
        return;
      }

      if (projectId && clientEmail && privateKey) {
        // Fix potential newline escaping in private key
        if (privateKey.includes('\\n')) {
          privateKey = privateKey.replace(/\\n/g, '\n');
        }

        this.firebaseApp = initializeApp({
          credential: cert({
            projectId,
            clientEmail,
            privateKey,
          }),
        });
        this.logger.log('Firebase Admin SDK successfully initialized via Env Cert.');
      } else if (credentialsPath) {
        this.firebaseApp = initializeApp({
          credential: cert(credentialsPath),
        });
        this.logger.log(`Firebase Admin SDK successfully initialized via Service Account file: ${credentialsPath}`);
      } else {
        this.isMockMode = true;
        this.logger.warn('Firebase configuration missing (projectID, clientEmail, or privateKey). Running in MOCK Mode.');
      }
    } catch (error) {
      this.isMockMode = true;
      this.logger.error('Failed to initialize Firebase Admin SDK. Falling back to MOCK Mode.', error);
    }
  }

  /**
   * Registers or updates a device notification token for a user.
   */
  async registerToken(userId: number, data: RegisterTokenDto) {

    // Upsert the token
    return await this.prisma.notificationToken.upsert({
      where: { token: data.token },
      update: {
        userId: userId,
        deviceId: data.deviceId ?? null,
        platform: data.platform ?? null,
      },
      create: {
        token: data.token,
        userId: userId,
        deviceId: data.deviceId ?? null,
        platform: data.platform ?? null,
      },
    });
  }

  /**
   * Removes a registered device token (e.g., on logout).
   */
  async unregisterToken(token: string) {
    try {
      await this.prisma.notificationToken.delete({
        where: { token },
      });
      this.logger.log(`Unregistered token: ${token.substring(0, 10)}...`);
    } catch (error) {
      this.logger.debug(`Token not found or already deleted: ${token.substring(0, 10)}...`);
    }
  }

  /**
   * Sends a push notification to all registered tokens of a user.
   */
  async sendNotificationToUser(
    userId: number,
    title: string,
    body: string,
    data?: Record<string, string>,
    actorId?: number,
  ) {
    const userIdStr = Number(userId);
    const actorIdStr = actorId ? Number(actorId) : undefined;

    // Resolve target user IDs safely (checking if the passed ID is customerId and maps to User.id)
    const targetUserIds = [userIdStr];
    const customer = await this.prisma.customer.findUnique({
      where: { id: userIdStr },
      select: { userId: true },
    });
    if (customer && customer.userId) {
      targetUserIds.push(customer.userId);
    }

    // 1. Fetch user's registered tokens
    const tokens = await this.prisma.notificationToken.findMany({
      where: { userId: { in: targetUserIds } },
      select: { token: true },
    });

    const tokenStrings = tokens.map((t) => t.token);

    // 2. Log event in database history
    const event = await this.prisma.notificationEvent.create({
      data: {
        type: data?.type || 'PUSH_NOTIFICATION',
        entityId: userIdStr,
        actorId: actorIdStr || null,
        payload: {
          title,
          body,
          data: data || {},
        },
        processed: false,
      },
    });

    if (tokenStrings.length === 0) {
      this.logger.warn(`No registered notification tokens found for user ID: ${userIdStr}`);
      return { eventId: event.id, sentCount: 0, failedCount: 0 };
    }

    if (this.isMockMode) {
      this.logger.log(`[MOCK NOTIFICATION] User: ${userIdStr} | Title: "${title}" | Body: "${body}"`);
      await this.prisma.notificationEvent.update({
        where: { id: event.id },
        data: { processed: true },
      });
      return { eventId: event.id, sentCount: tokenStrings.length, failedCount: 0 };
    }

    try {
      const message: MulticastMessage = {
        tokens: tokenStrings,
        notification: {
          title,
          body,
        },
        data: data || {},
      };

      const response = await getMessaging().sendEachForMulticast(message);

      this.logger.log(`Sent multicast message. Success: ${response.successCount}, Failure: ${response.failureCount}`);

      // 3. Prune invalid/stale tokens based on FCM errors
      const tokensToRemove: string[] = [];
      response.responses.forEach((res: any, index: number) => {
        if (!res.success && res.error) {
          const errorCode = res.error.code;
          if (
            errorCode === 'messaging/invalid-registration-token' ||
            errorCode === 'messaging/registration-token-not-registered'
          ) {
            tokensToRemove.push(tokenStrings[index]!);
          }
        }
      });

      if (tokensToRemove.length > 0) {
        await this.prisma.notificationToken.deleteMany({
          where: { token: { in: tokensToRemove } },
        });
        this.logger.log(`Cleaned up ${tokensToRemove.length} invalid/stale device tokens.`);
      }

      // Mark the event as processed
      await this.prisma.notificationEvent.update({
        where: { id: event.id },
        data: { processed: true },
      });

      return {
        eventId: event.id,
        sentCount: response.successCount,
        failedCount: response.failureCount,
      };
    } catch (error) {
      this.logger.error(`Failed to send FCM notifications to user ID: ${userIdStr}`, error);
      return { eventId: event.id, sentCount: 0, failedCount: tokenStrings.length };
    }
  }

  /**
   * Helper to compile simple template placeholders (e.g. {{name}} -> Shubham).
   */
  private compileTemplate(text: string, variables: Record<string, any>): string {
    let result = text;
    for (const [key, value] of Object.entries(variables)) {
      result = result.replace(new RegExp(`{{\\s*${key}\\s*}}`, 'g'), String(value));
    }
    return result;
  }

  /**
   * Sends a notification dynamically using a configured template in `NotificationTemplate`.
   */
  async sendNotificationWithTemplate(
    userId: number,
    templateKey: NotificationTemplateKey,
    variables: Record<string, any>,
    extraData?: Record<string, string>,
    actorId?: number,
  ) {
    let title = '';
    let body = '';

    try {
      const rendered = await this.notificationTemplateService.render(templateKey, variables);
      title = rendered.title;
      body = rendered.body;
    } catch (error: any) {
      this.logger.warn(`Template rendering via NotificationTemplateService failed: ${error.message}. Falling back to DB/default rendering.`);

      // 1. Try to find the template in DB
      const template = await this.prisma.notificationTemplate.findUnique({
        where: { key: templateKey },
      });

      if (template) {
        title = this.compileTemplate(template.title, variables);
        body = this.compileTemplate(template.body, variables);
      } else {
        this.logger.warn(`Template with key: "${templateKey}" not found. Falling back to default payload.`);
        // Default fallbacks based on common templates
        switch (templateKey) {
          case 'RechargeSuccess':
            title = 'Recharge Success';
            body = `+${variables.credits} credits added. Total: ${variables.totalCredits}`;
            break;
          case 'LowBalance':
            title = 'Low Credit Alert';
            body = `You have only ${variables.balance} meal credits remaining. Recharge now to continue service.`;
            break;
          case 'CriticalBalance':
            title = 'Critical Credit Alert';
            body = `Urgent! Only ${variables.balance} meal credits remain.`;
            break;
          case 'ZeroBalance':
            title = 'Credits Exhausted';
            body = 'No credits remaining. Recharge to continue receiving meals.';
            break;
          case 'OutstandingBalance':
            title = 'Outstanding Balance Created';
            body = `You have consumed ${variables.outstandingCount} meals beyond your prepaid balance. Please recharge.`;
            break;
          case 'RefundApproved':
            title = 'Refund Request Approved';
            body = `Your refund request has been processed. Deducted ${variables.credits} credits. Refund amount: ₹${variables.amount}`;
            break;
          case 'RefundRejected':
            title = 'Refund Request Rejected';
            body = `Your refund request of ${variables.credits} credits was rejected: ${variables.reason}`;
            break;
          case 'PauseApproved':
            title = 'Pause Request Approved';
            body = `Your subscription pause request from ${variables.startDate} to ${variables.endDate} has been approved.`;
            break;
          case 'CancellationApproved':
            title = 'Subscription Cancelled';
            body = 'Your subscription has been cancelled. No future deliveries will be scheduled.';
            break;
          case 'BREAKFAST_MENU_REMINDER':
            title = '🍳 Breakfast Menu Reminder';
            body = `Hello ${variables.vendorName}, please upload today's breakfast menu.`;
            break;
          case 'LUNCH_MENU_REMINDER':
            title = '🍱 Lunch Menu Reminder';
            body = `Hello ${variables.vendorName}, please upload today's lunch menu.`;
            break;
          case 'DINNER_MENU_REMINDER':
            title = '🍽️ Dinner Menu Reminder';
            body = `Hello ${variables.vendorName}, please upload today's dinner menu.`;
            break;
          default:
            title = (templateKey as string).replace(/([A-Z])/g, ' $1').trim();
            body = JSON.stringify(variables);
        }
      }
    }

    const mergedData = {
      type: templateKey,
      ...extraData,
    };

    return await this.sendNotificationToUser(userId, title, body, mergedData, actorId);
  }

  /**
   * Private helper to send push notifications to a list of tokens, chunked in batches of 500.
   */
  private async sendMulticastNotification(
    tokens: string[],
    title: string,
    body: string,
    data?: Record<string, string>,
  ): Promise<{ sentCount: number; failedCount: number }> {
    if (tokens.length === 0) {
      return { sentCount: 0, failedCount: 0 };
    }

    if (this.isMockMode) {
      this.logger.log(`[MOCK NOTIFICATION] Tokens: ${tokens.length} | Title: "${title}" | Body: "${body}"`);
      return { sentCount: tokens.length, failedCount: 0 };
    }

    try {
      const batchSize = 500;
      let totalSent = 0;
      let totalFailed = 0;
      const tokensToRemove: string[] = [];

      for (let i = 0; i < tokens.length; i += batchSize) {
        const batchTokens = tokens.slice(i, i + batchSize);
        const message: MulticastMessage = {
          tokens: batchTokens,
          notification: {
            title,
            body,
          },
          data: data || {},
        };

        const response = await getMessaging().sendEachForMulticast(message);
        totalSent += response.successCount;
        totalFailed += response.failureCount;

        // Prune invalid/stale tokens based on FCM errors
        response.responses.forEach((res: any, index: number) => {
          if (!res.success && res.error) {
            const errorCode = res.error.code;
            if (
              errorCode === 'messaging/invalid-registration-token' ||
              errorCode === 'messaging/registration-token-not-registered'
            ) {
              tokensToRemove.push(batchTokens[index]!);
            }
          }
        });
      }

      if (tokensToRemove.length > 0) {
        await this.prisma.notificationToken.deleteMany({
          where: { token: { in: tokensToRemove } },
        });
        this.logger.log(`Cleaned up ${tokensToRemove.length} invalid/stale device tokens.`);
      }

      return { sentCount: totalSent, failedCount: totalFailed };
    } catch (error) {
      this.logger.error(`Failed to send multicast notifications`, error);
      return { sentCount: 0, failedCount: tokens.length };
    }
  }

  /**
   * Sends a template-based notification to ALL active/registered customers.
   * Checks required fields before rendering.
   */
  async sendNotificationToAllCustomers(
    templateKey: string,
    variables: Record<string, any>,
    options?: { extraData?: Record<string, string>; actorId?: number },
  ) {
    const rendered = await this.notificationTemplateService.render(templateKey, variables);

    // Fetch all active/registered customers
    const customers = await this.prisma.customer.findMany({
      where: {
        userId: { not: null },
        status: { not: 'Blocked' },
      },
      select: { id: true, userId: true },
    });

    if (customers.length === 0) {
      return { sentCount: 0, failedCount: 0 };
    }

    const userIds = customers.map((c) => c.userId!);

    const tokens = await this.prisma.notificationToken.findMany({
      where: { userId: { in: userIds } },
      select: { token: true },
    });

    const tokenStrings = tokens.map((t) => t.token);

    const mergedData = {
      type: templateKey,
      ...options?.extraData,
    };

    const result = await this.sendMulticastNotification(
      tokenStrings,
      rendered.title,
      rendered.body,
      mergedData,
    );

    // Create history events for all customers
    const eventsData = customers.map((c) => ({
      type: templateKey,
      entityId: c.id,
      actorId: options?.actorId || null,
      payload: {
        title: rendered.title,
        body: rendered.body,
        data: mergedData,
      },
      processed: true,
    }));

    await this.prisma.notificationEvent.createMany({
      data: eventsData,
    });

    return result;
  }

  /**
   * Sends a template-based notification to a specific customer.
   * Checks required fields before rendering.
   */
  async sendNotificationToCustomer(
    customerId: number,
    templateKey: string,
    variables: Record<string, any>,
    options?: { extraData?: Record<string, string>; actorId?: number },
  ) {
    const rendered = await this.notificationTemplateService.render(templateKey, variables);

    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: { userId: true },
    });

    if (!customer || !customer.userId) {
      this.logger.warn(`Customer ID ${customerId} not found or has no user account`);
      return { sentCount: 0, failedCount: 0 };
    }

    const tokens = await this.prisma.notificationToken.findMany({
      where: { userId: customer.userId },
      select: { token: true },
    });

    const tokenStrings = tokens.map((t) => t.token);

    const mergedData = {
      type: templateKey,
      ...options?.extraData,
    };

    const result = await this.sendMulticastNotification(
      tokenStrings,
      rendered.title,
      rendered.body,
      mergedData,
    );

    // Log history event
    await this.prisma.notificationEvent.create({
      data: {
        type: templateKey,
        entityId: customerId,
        actorId: options?.actorId || null,
        payload: {
          title: rendered.title,
          body: rendered.body,
          data: mergedData,
        },
        processed: true,
      },
    });

    return result;
  }

  /**
   * Sends a template-based notification to ALL active vendors.
   * Checks required fields before rendering.
   */
  async sendNotificationToAllVendors(
    templateKey: string,
    variables: Record<string, any>,
    options?: { extraData?: Record<string, string>; actorId?: number },
  ) {
    const rendered = await this.notificationTemplateService.render(templateKey, variables);

    // Fetch all active vendors
    const vendors = await this.prisma.vendor.findMany({
      where: { status: 'Active' },
      select: { id: true },
    });

    if (vendors.length === 0) {
      return { sentCount: 0, failedCount: 0 };
    }

    const vendorIds = vendors.map((v) => v.id);

    const tokens = await this.prisma.notificationToken.findMany({
      where: { userId: { in: vendorIds } },
      select: { token: true },
    });

    const tokenStrings = tokens.map((t) => t.token);

    const mergedData = {
      type: templateKey,
      ...options?.extraData,
    };

    const result = await this.sendMulticastNotification(
      tokenStrings,
      rendered.title,
      rendered.body,
      mergedData,
    );

    // Create history events for all vendors
    const eventsData = vendors.map((v) => ({
      type: templateKey,
      entityId: v.id,
      actorId: options?.actorId || null,
      payload: {
        title: rendered.title,
        body: rendered.body,
        data: mergedData,
      },
      processed: true,
    }));

    await this.prisma.notificationEvent.createMany({
      data: eventsData,
    });

    return result;
  }

  /**
   * Sends a template-based notification to a specific vendor.
   * Checks required fields before rendering.
   */
  async sendNotificationToVendor(
    vendorId: number,
    templateKey: string,
    variables: Record<string, any>,
    options?: { extraData?: Record<string, string>; actorId?: number },
  ) {
    const rendered = await this.notificationTemplateService.render(templateKey, variables);

    const vendor = await this.prisma.vendor.findUnique({
      where: { id: vendorId },
      select: { id: true },
    });

    if (!vendor) {
      this.logger.warn(`Vendor ID ${vendorId} not found`);
      return { sentCount: 0, failedCount: 0 };
    }

    const tokens = await this.prisma.notificationToken.findMany({
      where: { userId: vendorId },
      select: { token: true },
    });

    const tokenStrings = tokens.map((t) => t.token);

    const mergedData = {
      type: templateKey,
      ...options?.extraData,
    };

    const result = await this.sendMulticastNotification(
      tokenStrings,
      rendered.title,
      rendered.body,
      mergedData,
    );

    // Log history event
    await this.prisma.notificationEvent.create({
      data: {
        type: templateKey,
        entityId: vendorId,
        actorId: options?.actorId || null,
        payload: {
          title: rendered.title,
          body: rendered.body,
          data: mergedData,
        },
        processed: true,
      },
    });

    return result;
  }
}
