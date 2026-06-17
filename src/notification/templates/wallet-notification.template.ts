export enum WalletNotificationTemplateKey {
  RechargeSuccess = 'RechargeSuccess',
  LowBalance = 'LowBalance',
  CriticalBalance = 'CriticalBalance',
  ZeroBalance = 'ZeroBalance',
  OutstandingBalance = 'OutstandingBalance',
  RefundApproved = 'RefundApproved',
  RefundRejected = 'RefundRejected',
  PauseApproved = 'PauseApproved',
  CancellationApproved = 'CancellationApproved',
}

export const WalletNotificationTemplates = {
  [WalletNotificationTemplateKey.RechargeSuccess]: {
    title: 'Recharge Success',
    body: '+{{credits}} credits added. Total: {{totalCredits}}',
    requiredFields: ['credits', 'totalCredits'],
  },
  [WalletNotificationTemplateKey.LowBalance]: {
    title: 'Low Credit Alert',
    body: 'You have only {{balance}} meal credits remaining. Recharge now to continue service.',
    requiredFields: ['balance'],
  },
  [WalletNotificationTemplateKey.CriticalBalance]: {
    title: 'Critical Credit Alert',
    body: 'Urgent! Only {{balance}} meal credits remain.',
    requiredFields: ['balance'],
  },
  [WalletNotificationTemplateKey.ZeroBalance]: {
    title: 'Credits Exhausted',
    body: 'No credits remaining. Recharge to continue receiving meals.',
    requiredFields: [],
  },
  [WalletNotificationTemplateKey.OutstandingBalance]: {
    title: 'Outstanding Balance Created',
    body: 'You have consumed {{outstandingCount}} meals beyond your prepaid balance. Please recharge.',
    requiredFields: ['outstandingCount'],
  },
  [WalletNotificationTemplateKey.RefundApproved]: {
    title: 'Refund Request Approved',
    body: 'Your refund request has been processed. Deducted {{credits}} credits. Refund amount: ₹{{amount}}',
    requiredFields: ['credits', 'amount'],
  },
  [WalletNotificationTemplateKey.RefundRejected]: {
    title: 'Refund Request Rejected',
    body: 'Your refund request of {{credits}} credits was rejected: {{reason}}',
    requiredFields: ['credits', 'reason'],
  },
  [WalletNotificationTemplateKey.PauseApproved]: {
    title: 'Pause Request Approved',
    body: 'Your subscription pause request from {{startDate}} to {{endDate}} has been approved.',
    requiredFields: ['startDate', 'endDate'],
  },
  [WalletNotificationTemplateKey.CancellationApproved]: {
    title: 'Subscription Cancelled',
    body: 'Your subscription has been cancelled. No future deliveries will be scheduled.',
    requiredFields: [],
  },
};
