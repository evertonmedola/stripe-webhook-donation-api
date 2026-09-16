import { Test } from '@nestjs/testing';
import { CheckoutController } from './checkout.controller';
import { CheckoutService } from './checkout.service';

describe('CheckoutController', () => {
  it('delegates to CheckoutService.createSession and returns its result', async () => {
    const service = { createSession: jest.fn().mockResolvedValue({ checkoutUrl: 'https://checkout.stripe.com/x' }) };
    const module = await Test.createTestingModule({
      controllers: [CheckoutController],
      providers: [{ provide: CheckoutService, useValue: service }],
    }).compile();
    const controller = module.get(CheckoutController);

    const dto = { productType: 'fixed' as const, priceId: 'price_1' };
    const result = await controller.create(dto);

    expect(service.createSession).toHaveBeenCalledWith(dto);
    expect(result).toEqual({ checkoutUrl: 'https://checkout.stripe.com/x' });
  });
});
