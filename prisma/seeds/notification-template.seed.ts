import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function seedNotificationTemplates() {
  const templates = [
    {
      key: 'RechargeSuccess',
      title: 'Recharge Success',
      body: '+{{credits}} credits added. Total: {{totalCredits}}',
    },
    {
      key: 'LowBalance',
      title: 'Low Credit Alert',
      body: 'You have only {{balance}} meal credits remaining. Recharge now to continue service.',
    },
    {
      key: 'CriticalBalance',
      title: 'Critical Credit Alert',
      body: 'Urgent! Only {{balance}} meal credits remain.',
    },
    {
      key: 'ZeroBalance',
      title: 'Credits Exhausted',
      body: 'No credits remaining. Recharge to continue receiving meals.',
    },
    {
      key: 'OutstandingBalance',
      title: 'Outstanding Balance Created',
      body: 'You have consumed {{outstandingCount}} meals beyond your prepaid balance. Please recharge.',
    },
    {
      key: 'RefundApproved',
      title: 'Refund Request Approved',
      body: 'Your refund request has been processed. Deducted {{credits}} credits. Refund amount: ₹{{amount}}',
    },
    {
      key: 'RefundRejected',
      title: 'Refund Request Rejected',
      body: 'Your refund request of {{credits}} credits was rejected: {{reason}}',
    },
    {
      key: 'PauseApproved',
      title: 'Pause Request Approved',
      body: 'Your subscription pause request from {{startDate}} to {{endDate}} has been approved.',
    },
    {
      key: 'CancellationApproved',
      title: 'Subscription Cancelled',
      body: 'Your subscription has been cancelled. No future deliveries will be scheduled.',
    },
  ];

  console.log('🌱 Seeding notification templates...');

  for (const template of templates) {
    await prisma.notificationTemplate.upsert({
      where: { key: template.key },
      update: {
        title: template.title,
        body: template.body,
      },
      create: {
        key: template.key,
        title: template.title,
        body: template.body,
      },
    });
  }

  console.log('✅ Notification templates seeded successfully');
}
