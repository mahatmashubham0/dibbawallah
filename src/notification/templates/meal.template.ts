import { NotificationTemplateKey } from '../notification.types';

export const MealTemplates = {
    [NotificationTemplateKey.MEAL_DELIVERED]: {
        title: 'Meal Delivered 🚚',
        body: 'Your {{mealType}} has been delivered.',
        requiredFields: ['mealType'],
    },
    [NotificationTemplateKey.MEAL_CANCELLED]: {
        title: 'Meal Cancelled ❌',
        body: 'Your {{mealType}} delivery for {{date}} has been cancelled.',
        requiredFields: ['mealType', 'date'],
    },
};
