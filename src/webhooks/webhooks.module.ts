import { Module } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { StripeWebhookController } from './stripe-webhook.controller';
import { StripeWebhookService } from './stripe-webhook.service';
import { stripeClientProvider } from '../checkout/stripe.provider';
import { stripeWebhookSecretProvider } from './webhook-secret.provider';

@Module({
  imports: [OrdersModule, AuditLogModule],
  controllers: [StripeWebhookController],
  providers: [StripeWebhookService, stripeClientProvider, stripeWebhookSecretProvider],
})
export class WebhooksModule {}
