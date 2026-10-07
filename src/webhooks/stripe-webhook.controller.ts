import { BadRequestException, Controller, Headers, HttpCode, Post, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { StripeWebhookService } from './stripe-webhook.service';

@Controller('webhooks')
export class StripeWebhookController {
  constructor(private readonly webhookService: StripeWebhookService) {}

  @Post('stripe')
  @HttpCode(200)
  @Throttle({ default: { limit: 100, ttl: 60_000 } })
  async handle(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature: string,
  ): Promise<{ received: true }> {
    // Nest's raw-body parser only populates req.rawBody for content-types it
    // claims. A caller POSTing with an unclaimed content-type leaves it
    // undefined, in which case it must never be passed on to
    // stripe.webhooks.constructEvent() (which requires a Buffer).
    if (!req.rawBody) {
      throw new BadRequestException('Missing request body');
    }
    const { outcome } = await this.webhookService.handleRawEvent(req.rawBody, signature);
    // A rejected signature must surface as a 4xx: returning 200 here would
    // tell Stripe the event was acknowledged, so a genuinely failed
    // delivery (misconfigured secret, tampered payload) would never be
    // retried and would look identical to a normal, successfully-processed
    // request in Stripe's dashboard.
    if (outcome === 'rejected') {
      throw new BadRequestException('Invalid signature');
    }
    return { received: true };
  }
}
