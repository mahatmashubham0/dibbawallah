import { registerAs } from '@nestjs/config';

export const locationConfigFactory = registerAs('location', () => ({
  geoapifyApiKey: process.env.GEOAPIFY_API_KEY,
  geoapifyBaseUrl:
    process.env.GEOAPIFY_BASE_URL || 'https://api.geoapify.com/v1',
  geoapifyLimit: Number(process.env.GEOAPIFY_LIMIT || 10),
}));
