import { NotificationTemplateKey } from '../notification.types';

export const AuthTemplates = {
  [NotificationTemplateKey.OTP_SENT]: {
    title: 'Verification Code',
    body: 'Your OTP code is {{code}}.',
    requiredFields: ['code'],
  },
  [NotificationTemplateKey.WELCOME]: {
    title: 'Welcome to Dibbawallah',
    body: 'Hello {{name}}, welcome to Dibbawallah! Your subscription is now active.',
    requiredFields: ['name'],
  },
};
