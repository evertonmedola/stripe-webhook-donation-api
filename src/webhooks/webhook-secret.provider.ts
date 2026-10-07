import { ConfigService } from '@nestjs/config';

export const STRIPE_WEBHOOK_SECRET = 'STRIPE_WEBHOOK_SECRET';

export const stripeWebhookSecretProvider = {
  provide: STRIPE_WEBHOOK_SECRET,
  inject: [ConfigService],
  useFactory: (config: ConfigService) => config.get<string>('STRIPE_WEBHOOK_SECRET')!,
};
