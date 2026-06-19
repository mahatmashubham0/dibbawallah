import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma';
import { BillingAction, Prisma } from '@prisma/client';
import { UserType } from '@Common';

@Injectable()
export class SubscriptionLogsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    data: {
      vendorCustomerId: number;
      actionType: BillingAction;
      actorId?: number;
      actorType?: UserType;
      amount?: number | Prisma.Decimal;
      oldPlanVersionId?: number | null;
      newPlanVersionId?: number | null;
      creditsBefore?: number | null;
      creditsAdded?: number | null;
      creditsAfter?: number | null;
      totalCreditsBefore?: number | null;
      totalCreditsAfter?: number | null;
      usedCreditsBefore?: number | null;
      usedCreditsAfter?: number | null;
      metadata?: any;
      remarks?: string;
    },
    tx?: Prisma.TransactionClient,
  ) {
    const client = tx || this.prisma;
    return (client.subscriptionLog as any).create({
      data: {
        vendorCustomerId: data.vendorCustomerId,
        actionType: data.actionType,
        actorId: data.actorId,
        actorType: data.actorType,
        amount: data.amount,
        oldPlanVersionId: data.oldPlanVersionId,
        newPlanVersionId: data.newPlanVersionId,
        creditsBefore: data.creditsBefore,
        creditsAdded: data.creditsAdded,
        creditsAfter: data.creditsAfter,
        totalCreditsBefore: data.totalCreditsBefore,
        totalCreditsAfter: data.totalCreditsAfter,
        usedCreditsBefore: data.usedCreditsBefore,
        usedCreditsAfter: data.usedCreditsAfter,
        metadata: data.metadata ?? undefined,
        remarks: data.remarks,
      },
    });
  }
}
