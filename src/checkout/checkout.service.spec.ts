import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BadRequestException } from '@nestjs/common';
import { CheckoutService } from './checkout.service';
import { OrdersService } from '../orders/orders.service';
import { STRIPE_CLIENT } from './stripe.provider';
import { CreateCheckoutSessionDto } from './dto/create-checkout-session.dto';

describe('CheckoutService', () => {
  let service: CheckoutService;
  let ordersService: { createPendingOrder: jest.Mock; attachStripeSessionId: jest.Mock };
  let stripeClient: { checkout: { sessions: { create: jest.Mock } } };
  let config: { get: jest.Mock };

  beforeEach(async () => {
    ordersService = {
      createPendingOrder: jest.fn().mockResolvedValue({ id: 'order_1' }),
      attachStripeSessionId: jest.fn().mockResolvedValue(undefined),
    };
    stripeClient = {
      checkout: { sessions: { create: jest.fn().mockResolvedValue({ id: 'cs_test_1', url: 'https://checkout.stripe.com/cs_test_1' }) } },
    };
    config = {
      get: jest.fn((key: string) => {
        const values: Record<string, string> = {
          STRIPE_ALLOWED_PRICE_IDS: 'price_allowed_1,price_allowed_2',
          MIN_DONATION_CENTS: '500',
          MAX_DONATION_CENTS: '100000',
          FRONTEND_ORIGIN: 'http://localhost:3000',
        };
        return values[key];
      }),
    };

    const module = await Test.createTestingModule({
      providers: [
        CheckoutService,
        { provide: OrdersService, useValue: ordersService },
        { provide: STRIPE_CLIENT, useValue: stripeClient },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();
    service = module.get(CheckoutService);
  });

  it('creates a pending order and a Stripe session for an allowlisted fixed price', async () => {
    const result = await service.createSession({ productType: 'fixed', priceId: 'price_allowed_1' });
    expect(result.checkoutUrl).toBe('https://checkout.stripe.com/cs_test_1');
    expect(ordersService.createPendingOrder).toHaveBeenCalled();
    expect(stripeClient.checkout.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({ currency: 'brl' }),
    );
  });

  it('rejects a fixed priceId not in the allowlist', async () => {
    await expect(
      service.createSession({ productType: 'fixed', priceId: 'price_not_allowed' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(stripeClient.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it('accepts a custom amount within range', async () => {
    const result = await service.createSession({ productType: 'custom', amountCents: 5000 });
    expect(result.checkoutUrl).toBe('https://checkout.stripe.com/cs_test_1');
  });

  it('rejects a custom amount below the minimum', async () => {
    await expect(
      service.createSession({ productType: 'custom', amountCents: 100 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(stripeClient.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it('rejects a custom amount above the maximum', async () => {
    await expect(
      service.createSession({ productType: 'custom', amountCents: 999_999_999 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(stripeClient.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it('rejects undefined amountCents for custom product', async () => {
    await expect(
      service.createSession({ productType: 'custom' } as CreateCheckoutSessionDto),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(stripeClient.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it('fails closed (does not silently accept) when MIN_DONATION_CENTS/MAX_DONATION_CENTS config is missing', async () => {
    config.get.mockImplementation((key: string) => {
      const values: Record<string, string> = {
        STRIPE_ALLOWED_PRICE_IDS: 'price_allowed_1,price_allowed_2',
        MAX_DONATION_CENTS: '100000',
        FRONTEND_ORIGIN: 'http://localhost:3000',
      };
      return values[key];
    });

    await expect(
      service.createSession({ productType: 'custom', amountCents: 5000 }),
    ).rejects.toThrow();
    expect(stripeClient.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it('never forwards a client-supplied currency to Stripe', async () => {
    await service.createSession({
      productType: 'custom',
      amountCents: 5000,
      // @ts-expect-error proving extra fields are ignored, not forwarded
      currency: 'usd',
    });
    expect(stripeClient.checkout.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({ currency: 'brl' }),
    );
  });
});
