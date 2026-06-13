import { registerAs } from '@nestjs/config';

export const firebaseConfigFactory = registerAs('firebase', () => ({
  projectId: process.env.FIREBASE_PROJECT_ID,
  clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
  privateKey: process.env.FIREBASE_PRIVATE_KEY,
  credentialsPath: process.env.FIREBASE_CREDENTIALS_PATH,
}));
