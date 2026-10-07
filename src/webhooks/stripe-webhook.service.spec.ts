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
    isTransactionActive: boolean;
  };
  let dataSource: { createQueryRunner: jest.Mock };
  let auditLog: { record: jest.Mock };
  let stripeClient: Stripe;

  beforeEach(async () => {
    // isTransactionActive mirrors TypeORM's real PostgresQueryRunner
    // behavior: startTransaction() sets it true, commit/rollback set it
    // false. safeRollback() in the service reads this flag to decide
    // whether a second rollback attempt is safe to skip.
    queryRunnerMock = {
      connect: jest.fn(),
      startTransaction: jest.fn().mockImplementation(async () => {
        queryRunnerMock.isTransactionActive = true;
      }),
      commitTransaction: jest.fn().mockImplementation(async () => {
        queryRunnerMock.isTransactionActive = false;
      }),
      rollbackTransaction: jest.fn().mockImplementation(async () => {
        queryRunnerMock.isTransactionActive = false;
      }),
      release: jest.fn(),
      query: jest.fn().mockResolvedValue([[], 1]),
      manager: {},
      isTransactionActive: false,
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

  it('releases the queryRunner and records a connection_error when connect() throws, without leaking the connection', async () => {
    const connectError = new Error('pool exhausted');
    queryRunnerMock.connect.mockRejectedValueOnce(connectError);
    const payload = JSON.stringify({ id: 'evt_5', type: 'some.unhandled.type', data: { object: {} } });
    const header = signPayload(payload);

    await expect(service.handleRawEvent(Buffer.from(payload), header)).rejects.toThrow('pool exhausted');

    // TypeORM's QueryRunner.release() is safe to call even when connect()
    // never succeeded (it short-circuits via an internal isReleased flag and
    // has no live connection to release), so the finally block calling
    // release() unconditionally is correct and must still happen here to
    // avoid leaking the queryRunner.
    expect(queryRunnerMock.release).toHaveBeenCalled();
    expect(queryRunnerMock.startTransaction).not.toHaveBeenCalled();
    expect(queryRunnerMock.rollbackTransaction).not.toHaveBeenCalled();
    expect(auditLog.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'connection_error', eventId: 'evt_5', reason: 'pool exhausted' }),
    );
  });

  it('releases the queryRunner and records a connection_error when startTransaction() throws', async () => {
    const startTxError = new Error('could not start transaction');
    queryRunnerMock.startTransaction.mockRejectedValueOnce(startTxError);
    const payload = JSON.stringify({ id: 'evt_6', type: 'some.unhandled.type', data: { object: {} } });
    const header = signPayload(payload);

    await expect(service.handleRawEvent(Buffer.from(payload), header)).rejects.toThrow(
      'could not start transaction',
    );

    expect(queryRunnerMock.release).toHaveBeenCalled();
    expect(queryRunnerMock.query).not.toHaveBeenCalled();
    expect(auditLog.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'connection_error', eventId: 'evt_6' }),
    );
  });

  it('does not let a second/invalid rollback attempt mask the original error when auditLog.record() throws after a rollback already happened', async () => {
    queryRunnerMock.query.mockResolvedValueOnce([[], 0]); // duplicate: 0 rows
    const auditError = new Error('audit sink unavailable');
    auditLog.record.mockRejectedValueOnce(auditError); // first call: the 'duplicate' record throws

    const payload = JSON.stringify({ id: 'evt_7', type: 'some.unhandled.type', data: { object: {} } });
    const header = signPayload(payload);

    await expect(service.handleRawEvent(Buffer.from(payload), header)).rejects.toThrow('audit sink unavailable');

    // rollbackTransaction() was only actually invoked once (the legitimate
    // duplicate-path rollback); the outer catch's safeRollback() saw
    // isTransactionActive === false and skipped calling it again, so the
    // original audit error propagated untouched instead of being masked by
    // a TransactionNotStartedError from a second rollback attempt.
    expect(queryRunnerMock.rollbackTransaction).toHaveBeenCalledTimes(1);
    expect(queryRunnerMock.release).toHaveBeenCalled();
  });
});
