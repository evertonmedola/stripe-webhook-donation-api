import { Module, OnModuleInit } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { StripeWebhookController } from './stripe-webhook.controller';
import { StripeWebhookService } from './stripe-webhook.service';
import { stripeClientProvider } from '../checkout/stripe.provider';
import { stripeWebhookSecretProvider } from './webhook-secret.provider';
import { checkoutCompletedHandler } from './handlers/checkout-completed.handler';
import { paymentFailedHandler } from './handlers/payment-failed.handler';
import { chargeRefundedHandler } from './handlers/charge-refunded.handler';

@Module({
  imports: [OrdersModule, AuditLogModule],
  controllers: [StripeWebhookController],
  providers: [StripeWebhookService, stripeClientProvider, stripeWebhookSecretProvider],
})
export class WebhooksModule implements OnModuleInit {
  constructor(private readonly webhookService: StripeWebhookService) {}

  onModuleInit() {
    this.webhookService.EVENT_HANDLERS['checkout.session.completed'] = checkoutCompletedHandler;
    this.webhookService.EVENT_HANDLERS['checkout.session.expired'] = paymentFailedHandler;
    this.webhookService.EVENT_HANDLERS['payment_intent.payment_failed'] = paymentFailedHandler;
    this.webhookService.EVENT_HANDLERS['charge.refunded'] = chargeRefundedHandler;
  }
}
