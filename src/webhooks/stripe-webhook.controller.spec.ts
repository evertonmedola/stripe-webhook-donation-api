import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { StripeWebhookController } from './stripe-webhook.controller';
import { StripeWebhookService } from './stripe-webhook.service';

describe('StripeWebhookController', () => {
  it('passes the raw body and signature header through to the service unmodified', async () => {
    const service = { handleRawEvent: jest.fn().mockResolvedValue({ outcome: 'processed' }) };
    const module = await Test.createTestingModule({
      controllers: [StripeWebhookController],
      providers: [{ provide: StripeWebhookService, useValue: service }],
    }).compile();
    const controller = module.get(StripeWebhookController);

    const rawBody = Buffer.from('{"id":"evt_1"}');
    const req = { rawBody } as never;
    await controller.handle(req, 'sig-header-value');

    expect(service.handleRawEvent).toHaveBeenCalledWith(rawBody, 'sig-header-value');
  });

  it('throws BadRequestException and never calls the service when req.rawBody is undefined', async () => {
    const service = { handleRawEvent: jest.fn().mockResolvedValue({ outcome: 'processed' }) };
    const module = await Test.createTestingModule({
      controllers: [StripeWebhookController],
      providers: [{ provide: StripeWebhookService, useValue: service }],
    }).compile();
    const controller = module.get(StripeWebhookController);

    const req = { rawBody: undefined } as never;

    await expect(controller.handle(req, 'sig-header-value')).rejects.toThrow(BadRequestException);
    expect(service.handleRawEvent).not.toHaveBeenCalled();
  });

  it('throws BadRequestException (so Stripe sees a 4xx and does not treat delivery as acknowledged) when the service rejects the event for an invalid signature', async () => {
    const service = { handleRawEvent: jest.fn().mockResolvedValue({ outcome: 'rejected' }) };
    const module = await Test.createTestingModule({
      controllers: [StripeWebhookController],
      providers: [{ provide: StripeWebhookService, useValue: service }],
    }).compile();
    const controller = module.get(StripeWebhookController);

    const req = { rawBody: Buffer.from('{}') } as never;

    await expect(controller.handle(req, 'bad-signature')).rejects.toThrow(BadRequestException);
  });

  it('resolves normally with {received: true} when the outcome is duplicate (Stripe should not retry an event we already saw)', async () => {
    const service = { handleRawEvent: jest.fn().mockResolvedValue({ outcome: 'duplicate' }) };
    const module = await Test.createTestingModule({
      controllers: [StripeWebhookController],
      providers: [{ provide: StripeWebhookService, useValue: service }],
    }).compile();
    const controller = module.get(StripeWebhookController);

    const req = { rawBody: Buffer.from('{}') } as never;

    await expect(controller.handle(req, 'sig-header-value')).resolves.toEqual({ received: true });
  });
});
