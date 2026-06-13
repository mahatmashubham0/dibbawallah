import { DailyMenuNotificationTemplates } from './templates/daily-menu-template';
import { PaymentTemplates } from './templates/payment.template';
import { MealTemplates } from './templates/meal.template';
import { SubscriptionTemplates } from './templates/subscription.template';
import { AuthTemplates } from './templates/auth.template';
import { WalletNotificationTemplates } from './templates/wallet-notification.template';

export const NotificationTemplateRegistry = {
    ...DailyMenuNotificationTemplates,
    ...PaymentTemplates,
    ...MealTemplates,
    ...SubscriptionTemplates,
    ...AuthTemplates,
    ...WalletNotificationTemplates,
};