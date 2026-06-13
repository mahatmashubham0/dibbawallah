// notification.templates.ts

export enum DailyMenuNotificationTemplateKey {
    BREAKFAST_MENU_REMINDER = 'BREAKFAST_MENU_REMINDER',
    LUNCH_MENU_REMINDER = 'LUNCH_MENU_REMINDER',
    DINNER_MENU_REMINDER = 'DINNER_MENU_REMINDER',
}

export const DailyMenuNotificationTemplates = {
    [DailyMenuNotificationTemplateKey.BREAKFAST_MENU_REMINDER]: {
        requiredFields: ['vendorName'],
        title: '🍳 Breakfast Menu Reminder',
        body: 'Hello {{vendorName}}, please upload today\'s breakfast menu.',
    },

    [DailyMenuNotificationTemplateKey.LUNCH_MENU_REMINDER]: {
        requiredFields: ['vendorName'],
        title: '🍱 Lunch Menu Reminder',
        body: 'Hello {{vendorName}}, please upload today\'s lunch menu.',
    },

    [DailyMenuNotificationTemplateKey.DINNER_MENU_REMINDER]: {
        requiredFields: ['vendorName'],
        title: '🍽️ Dinner Menu Reminder',
        body: 'Hello {{vendorName}}, please upload today\'s dinner menu.',
    },
};