import { NotificationTemplateKey } from '../notification.types';

export const SubscriptionTemplates = {
    [NotificationTemplateKey.SUBSCRIPTION_CREATED]: {
        title: 'Subscription Active 🎉',
        body: 'Your subscription to {{planName}} is now active.',
        requiredFields: ['planName'],
    },
    [NotificationTemplateKey.SUBSCRIPTION_EXPIRED]: {
        title: 'Subscription Expired ⚠️',
        body: 'Your subscription to {{planName}} has expired.',
        requiredFields: ['planName'],
    },
};
