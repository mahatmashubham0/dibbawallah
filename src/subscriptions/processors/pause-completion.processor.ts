import { BaseService, UtilsService } from '@Common';
import {
  Injectable,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma';
import { PauseRequestStatus, SubscriptionStatus } from '@prisma/client';
import { SubscriptionLogsService } from '../subscription-logs.service';

@Injectable()
export class PauseCompletionProcessorService
  extends BaseService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private isIdle = true;
  private isShuttingDown = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly utilsService: UtilsService,
    private readonly subscriptionLogsService: SubscriptionLogsService,
  ) {
    super();
  }

  async onApplicationBootstrap() {
    // Wait 10 seconds after boot before starting the run loop
    setTimeout(() => this.run(), 10000);
  }

  async onModuleDestroy() {
    this.isShuttingDown = true;
    await this.utilsService.waitUntilValue(() => this.isIdle, true);
  }

  private async run() {
    if (this.isShuttingDown || !this.isIdle) return;

    this.isIdle = false;

    try {
      // Normalize today to midnight for date-only comparison
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      // Find all approved pause requests where endDate is strictly less than today midnight
      const completedPauses = await this.prisma.pauseRequest.findMany({
        where: {
          status: PauseRequestStatus.Approved,
          endDate: {
            lt: todayStart,
          },
        },
        include: {
          subscription: true,
        },
      });
      console.log('completedPauses', completedPauses, todayStart);

      for (const pause of completedPauses) {
        if (this.isShuttingDown) break;

        await this.prisma.$transaction(async (tx) => {
          // 1. Activate the subscription
          await tx.subscription.update({
            where: { id: pause.subscriptionId },
            data: {
              pauseStartDate: null,
              pauseEndDate: null,
              status: SubscriptionStatus.Active,
            },
          });

          // 2. Update active pause request to Completed
          await tx.pauseRequest.update({
            where: { id: pause.id },
            data: { status: PauseRequestStatus.Completed },
          });

          // 3. Log SubscriptionLog
          await this.subscriptionLogsService.create(
            {
              vendorCustomerId: pause.subscription.vendorCustomerId,
              actionType: 'PauseCompleted',
              oldPlanVersionId: pause.subscription.planVersionId,
              newPlanVersionId: pause.subscription.planVersionId,
              remarks: `Subscription automatically resumed (pause ended on ${pause.endDate.toLocaleDateString()}).`,
              actorId: 0,
            },
            tx,
          );
        });

        this.logger.info(
          `Automatically resumed subscription ID: ${pause.subscriptionId} as pause request ID: ${pause.id} completed.`,
        );
      }
    } catch (err) {
      this.logger.error('Pause completion processor error', err);
    } finally {
      this.isIdle = true;

      if (!this.isShuttingDown) {
        // Run check loop every 30 seconds
        setTimeout(() => this.run(), 30000);
      }
    }
  }
}
