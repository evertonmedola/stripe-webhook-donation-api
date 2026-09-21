import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { OrdersService } from '../orders/orders.service';
import { STRIPE_CLIENT } from './stripe.provider';
import { CreateCheckoutSessionDto } from './dto/create-checkout-session.dto';

const CURRENCY = 'brl';

@Injectable()
export class CheckoutService {
  constructor(
    private readonly ordersService: OrdersService,
    @Inject(STRIPE_CLIENT) private readonly stripe: Stripe,
    private readonly config: ConfigService,
  ) {}

  async createSession(dto: CreateCheckoutSessionDto): Promise<{ checkoutUrl: string }> {
    const amountCents = this.resolveAmountCents(dto);

    const order = await this.ordersService.createPendingOrder({
      amountCents,
      currency: CURRENCY,
      stripeSessionId: `pending-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    });

    const frontendOrigin = this.config.get<string>('FRONTEND_ORIGIN')!;
    const lineItem: Stripe.Checkout.SessionCreateParams.LineItem =
      dto.productType === 'fixed'
        ? { price: dto.priceId!, quantity: 1 }
        : { price_data: { currency: CURRENCY, unit_amount: amountCents, product_data: { name: 'Doação' } }, quantity: 1 };

    const session = await this.stripe.checkout.sessions.create({
      mode: 'payment',
      currency: CURRENCY,
      line_items: [lineItem],
      success_url: `${frontendOrigin}/success.html?order=${order.id}`,
      cancel_url: `${frontendOrigin}/cancel.html`,
      metadata: { orderId: order.id },
      payment_intent_data: { metadata: { orderId: order.id } },
    });

    if (!session.url) {
      throw new BadRequestException('Stripe did not return a checkout URL');
    }

    await this.ordersService.attachStripeSessionId(order.id, session.id);

    return { checkoutUrl: session.url };
  }

  private resolveAmountCents(dto: CreateCheckoutSessionDto): number {
    if (dto.productType === 'fixed') {
      const allowedPriceIds = this.config.get<string>('STRIPE_ALLOWED_PRICE_IDS')!.split(',');
      if (!allowedPriceIds.includes(dto.priceId!)) {
        throw new BadRequestException('priceId is not allowed');
      }
      return 0; // amount is authoritative in Stripe for a Price; not tracked locally beyond the order placeholder
    }

    if (typeof dto.amountCents !== 'number' || !Number.isInteger(dto.amountCents)) {
      throw new BadRequestException('amountCents must be an integer');
    }

    const min = Number(this.config.get<string>('MIN_DONATION_CENTS'));
    const max = Number(this.config.get<string>('MAX_DONATION_CENTS'));
    if (Number.isNaN(min) || Number.isNaN(max)) {
      throw new Error('MIN_DONATION_CENTS/MAX_DONATION_CENTS misconfigured');
    }
    if (dto.amountCents! < min || dto.amountCents! > max) {
      throw new BadRequestException(`amountCents must be between ${min} and ${max}`);
    }
    return dto.amountCents!;
  }
}
