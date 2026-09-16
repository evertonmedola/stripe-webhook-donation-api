import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import Stripe from 'stripe';
import { StripeWebhookService } from './stripe-webhook.service';
import { OrdersService } from '../orders/orders.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { STRIPE_CLIENT } from '../checkout/stripe.provider';

const WEBHOOK_SECRET = 'whsec_test_secret';

function signPayload(payload: string) {
  return Stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
}

describe('StripeWebhookService', () => {
  let service: StripeWebhookService;
  let queryRunnerMock: {
    connect: jest.Mock; startTransaction: jest.Mock; commitTransaction: jest.Mock;
    rollbackTransaction: jest.Mock; release: jest.Mock; query: jest.Mock; manager: unknown;
  };
  let dataSource: { createQueryRunner: jest.Mock };
  let auditLog: { record: jest.Mock };
  let stripeClient: Stripe;

  beforeEach(async () => {
    queryRunnerMock = {
      connect: jest.fn(),
      startTransaction: jest.fn(),
      commitTransaction: jest.fn(),
      rollbackTransaction: jest.fn(),
      release: jest.fn(),
      query: jest.fn().mockResolvedValue([[], 1]),
      manager: {},
    };
    dataSource = { createQueryRunner: jest.fn().mockReturnValue(queryRunnerMock) };
    auditLog = { record: jest.fn().mockResolvedValue(undefined) };
    stripeClient = new Stripe('sk_test_dummy', { apiVersion: '2024-06-20' });

    const module = await Test.createTestingModule({
      providers: [
        StripeWebhookService,
        { provide: DataSource, useValue: dataSource },
        { provide: AuditLogService, useValue: auditLog },
        { provide: STRIPE_CLIENT, useValue: stripeClient },
        { provide: OrdersService, useValue: {} },
        { provide: 'STRIPE_WEBHOOK_SECRET', useValue: WEBHOOK_SECRET },
      ],
    }).compile();
    service = module.get(StripeWebhookService);
  });

  it('rejects a payload with an invalid signature without touching the database', async () => {
    const payload = JSON.stringify({ id: 'evt_1', type: 'unhandled.event', data: {} });
    const result = await service.handleRawEvent(Buffer.from(payload), 'invalid-signature-header');

    expect(result.outcome).toBe('rejected');
    expect(dataSource.createQueryRunner).not.toHaveBeenCalled();
    expect(auditLog.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'signature_invalid' }),
    );
  });

  it('processes a validly-signed unhandled event type as a no-op and commits', async () => {
    const payload = JSON.stringify({
      id: 'evt_2',
      type: 'some.unhandled.type',
      data: { object: {} },
    });
    const header = signPayload(payload);

    const result = await service.handleRawEvent(Buffer.from(payload), header);

    expect(result.outcome).toBe('processed');
    expect(queryRunnerMock.commitTransaction).toHaveBeenCalled();
    expect(auditLog.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'event_type_ignored', eventType: 'some.unhandled.type' }),
    );
  });

  it('treats a repeated event_id as a duplicate and rolls back without side effects', async () => {
    queryRunnerMock.query.mockResolvedValueOnce([[], 0]); // ON CONFLICT DO NOTHING -> 0 rows
    const payload = JSON.stringify({ id: 'evt_3', type: 'some.unhandled.type', data: { object: {} } });
    const header = signPayload(payload);

    const result = await service.handleRawEvent(Buffer.from(payload), header);

    expect(result.outcome).toBe('duplicate');
    expect(queryRunnerMock.rollbackTransaction).toHaveBeenCalled();
    expect(auditLog.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'duplicate', eventId: 'evt_3' }),
    );
  });

  it('rolls back the whole transaction, including the idempotency insert, when a handler throws', async () => {
    queryRunnerMock.query
      .mockResolvedValueOnce([[], 1]) // idempotency insert succeeds
      .mockImplementationOnce(() => {
        throw new Error('handler boom');
      });
    const payload = JSON.stringify({ id: 'evt_4', type: 'some.unhandled.type', data: { object: {} } });
    const header = signPayload(payload);

    // Force this event type to go through a handler that throws, by registering one:
    (service as unknown as { EVENT_HANDLERS: Record<string, unknown> }).EVENT_HANDLERS['some.unhandled.type'] =
      async () => {
        throw new Error('handler boom');
      };

    await expect(service.handleRawEvent(Buffer.from(payload), header)).rejects.toThrow('handler boom');
    expect(queryRunnerMock.rollbackTransaction).toHaveBeenCalled();
    expect(auditLog.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'processing_error', eventId: 'evt_4' }),
    );
  });
});
