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
    await this.webhookService.handleRawEvent(req.rawBody, signature);
    return { received: true };
  }
}
