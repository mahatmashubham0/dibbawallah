export enum PaymentNotificationTemplateKey {
    PAYMENT_RECEIVED = 'PAYMENT_RECEIVED',
    PAYMENT_PENDING = 'PAYMENT_PENDING',
}


export const PaymentTemplates = {
    [PaymentNotificationTemplateKey.PAYMENT_PENDING]: {
        title: 'Payment Pending',
        body: '₹{{amount}} payment is pending.',
        requiredFields: ['amount'],
    },

    [PaymentNotificationTemplateKey.PAYMENT_RECEIVED]: {
        title: 'Payment Received',
        body: '₹{{amount}} payment received successfully.',
        requiredFields: ['amount'],
    },
};