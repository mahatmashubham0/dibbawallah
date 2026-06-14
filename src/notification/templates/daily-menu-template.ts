// notification.templates.ts

export enum DailyMenuNotificationTemplateKey {
    BREAKFAST_MENU_REMINDER = 'BREAKFAST_MENU_REMINDER',
    LUNCH_MENU_REMINDER = 'LUNCH_MENU_REMINDER',
    DINNER_MENU_REMINDER = 'DINNER_MENU_REMINDER',
    NEW_MENU_POSTED = 'NEW_MENU_POSTED',
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

    [DailyMenuNotificationTemplateKey.NEW_MENU_POSTED]: {
        requiredFields: ['vendorName', 'mealType', 'menuItems'],
        title: 'New Menu Posted',
        body: '{{vendorName}} has posted a new {{mealType}} menu: {{menuItems}}',
    },
};