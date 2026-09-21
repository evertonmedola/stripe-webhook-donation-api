import { Test } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import Stripe from 'stripe';
import { OrderEntity } from '../../orders/entities/order.entity';
import { checkoutCompletedHandler } from './checkout-completed.handler';
import { paymentFailedHandler } from './payment-failed.handler';
import { chargeRefundedHandler } from './charge-refunded.handler';
import { paymentIntentSucceededHandler } from './payment-intent-succeeded.handler';

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://payment_user:payment_pass@localhost:5434/payment_validation';

function fakeEvent(type: string, object: Record<string, unknown>): Stripe.Event {
  return { id: 'evt_x', type, data: { object } } as unknown as Stripe.Event;
}

describe('webhook handlers (integration)', () => {
  let dataSource: DataSource;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({ type: 'postgres', url: TEST_DB_URL, entities: [OrderEntity], synchronize: false }),
      ],
    }).compile();
    dataSource = module.get(DataSource);
  });

  afterEach(async () => {
    // checkoutCompletedHandler inserts an email_outbox row referencing the
    // order (FK order_id -> orders.id), so it must be cleared first or the
    // DELETE FROM orders below violates the FK constraint.
    await dataSource.query('DELETE FROM email_outbox');
    await dataSource.query('DELETE FROM orders');
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  async function insertOrder(overrides: Partial<{ status: string; amountCents: number; sessionId: string }>) {
    const [row] = await dataSource.query(
      `INSERT INTO orders (status, amount_cents, stripe_session_id) VALUES ($1, $2, $3) RETURNING id`,
      [overrides.status ?? 'pending', overrides.amountCents ?? 5000, overrides.sessionId ?? 'cs_1'],
    );
    return row.id as string;
  }

  it('checkoutCompletedHandler transitions pending -> paid and stores donor_email', async () => {
    const orderId = await insertOrder({ sessionId: 'cs_completed' });
    const qr = dataSource.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();

    const event = fakeEvent('checkout.session.completed', {
      id: 'cs_completed',
      amount_total: 5000,
      payment_intent: 'pi_completed',
      customer_details: { email: 'donor@example.com' },
    });
    const result = await checkoutCompletedHandler(qr, event);
    await qr.commitTransaction();
    await qr.release();

    expect(result.orderId).toBe(orderId);
    const [row] = await dataSource.query(
      'SELECT status, donor_email, stripe_payment_intent_id FROM orders WHERE id = $1',
      [orderId],
    );
    expect(row.status).toBe('paid');
    expect(row.donor_email).toBe('donor@example.com');
    expect(row.stripe_payment_intent_id).toBe('pi_completed');
  });

  it('checkoutCompletedHandler backfills amount_cents from session.amount_total, closing the fixed-price amount_cents=0 gap', async () => {
    const orderId = await insertOrder({ amountCents: 0, sessionId: 'cs_fixed_price' });
    const qr = dataSource.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();

    const event = fakeEvent('checkout.session.completed', {
      id: 'cs_fixed_price',
      amount_total: 3500,
      payment_intent: 'pi_fixed_price',
      customer_details: { email: 'donor2@example.com' },
    });
    await checkoutCompletedHandler(qr, event);
    await qr.commitTransaction();
    await qr.release();

    const [row] = await dataSource.query('SELECT amount_cents FROM orders WHERE id = $1', [orderId]);
    expect(row.amount_cents).toBe(3500);
  });

  it('paymentFailedHandler transitions pending -> failed', async () => {
    const orderId = await insertOrder({ sessionId: 'cs_failed' });
    const qr = dataSource.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();

    const event = fakeEvent('checkout.session.expired', { id: 'cs_failed' });
    await paymentFailedHandler(qr, event);
    await qr.commitTransaction();
    await qr.release();

    const [row] = await dataSource.query('SELECT status FROM orders WHERE id = $1', [orderId]);
    expect(row.status).toBe('failed');
  });

  it('chargeRefundedHandler with full amount transitions paid -> refunded', async () => {
    const orderId = await insertOrder({ status: 'paid', amountCents: 5000, sessionId: 'cs_refund_full' });
    await dataSource.query('UPDATE orders SET stripe_payment_intent_id = $1 WHERE id = $2', ['pi_1', orderId]);
    const qr = dataSource.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();

    const event = fakeEvent('charge.refunded', { payment_intent: 'pi_1', amount_refunded: 5000 });
    await chargeRefundedHandler(qr, event);
    await qr.commitTransaction();
    await qr.release();

    const [row] = await dataSource.query(
      'SELECT status, refunded_amount_cents FROM orders WHERE id = $1',
      [orderId],
    );
    expect(row.status).toBe('refunded');
    expect(row.refunded_amount_cents).toBe(5000);
  });

  it('chargeRefundedHandler with partial amount keeps status=paid and records refunded_amount_cents', async () => {
    const orderId = await insertOrder({ status: 'paid', amountCents: 5000, sessionId: 'cs_refund_partial' });
    await dataSource.query('UPDATE orders SET stripe_payment_intent_id = $1 WHERE id = $2', ['pi_2', orderId]);
    const qr = dataSource.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();

    const event = fakeEvent('charge.refunded', { payment_intent: 'pi_2', amount_refunded: 2000 });
    await chargeRefundedHandler(qr, event);
    await qr.commitTransaction();
    await qr.release();

    const [row] = await dataSource.query(
      'SELECT status, refunded_amount_cents FROM orders WHERE id = $1',
      [orderId],
    );
    expect(row.status).toBe('paid');
    expect(row.refunded_amount_cents).toBe(2000);
  });

  it('chargeRefundedHandler with partial amount does NOT update refunded_amount_cents when order is not paid', async () => {
    const orderId = await insertOrder({ status: 'refunded', amountCents: 5000, sessionId: 'cs_refund_not_paid' });
    await dataSource.query(
      'UPDATE orders SET stripe_payment_intent_id = $1, refunded_amount_cents = $2 WHERE id = $3',
      ['pi_3', 5000, orderId],
    );
    const qr = dataSource.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();

    const event = fakeEvent('charge.refunded', { payment_intent: 'pi_3', amount_refunded: 2000 });
    await chargeRefundedHandler(qr, event);
    await qr.commitTransaction();
    await qr.release();

    const [row] = await dataSource.query(
      'SELECT status, refunded_amount_cents FROM orders WHERE id = $1',
      [orderId],
    );
    // Order was already refunded (not 'paid'), so the UPDATE's status guard
    // must prevent the partial-refund branch from touching this row at all.
    expect(row.status).toBe('refunded');
    expect(row.refunded_amount_cents).toBe(5000);
  });

  it('chargeRefundedHandler write is monotonic: a smaller amount_refunded delivered after a larger one does not decrease refunded_amount_cents', async () => {
    const orderId = await insertOrder({ status: 'paid', amountCents: 10000, sessionId: 'cs_refund_monotonic' });
    await dataSource.query('UPDATE orders SET stripe_payment_intent_id = $1 WHERE id = $2', ['pi_4', orderId]);

    // First delivery: a larger refunded amount is recorded.
    const qr1 = dataSource.createQueryRunner();
    await qr1.connect();
    await qr1.startTransaction();
    await chargeRefundedHandler(qr1, fakeEvent('charge.refunded', { payment_intent: 'pi_4', amount_refunded: 4000 }));
    await qr1.commitTransaction();
    await qr1.release();

    // Second delivery: an out-of-order, smaller snapshot arrives later.
    const qr2 = dataSource.createQueryRunner();
    await qr2.connect();
    await qr2.startTransaction();
    await chargeRefundedHandler(qr2, fakeEvent('charge.refunded', { payment_intent: 'pi_4', amount_refunded: 1000 }));
    await qr2.commitTransaction();
    await qr2.release();

    const [row] = await dataSource.query(
      'SELECT status, refunded_amount_cents FROM orders WHERE id = $1',
      [orderId],
    );
    expect(row.status).toBe('paid');
    expect(row.refunded_amount_cents).toBe(4000);
  });

  it('checkoutCompletedHandler does NOT insert an email_outbox row when the order is not pending', async () => {
    const orderId = await insertOrder({ status: 'failed', sessionId: 'cs_already_failed' });
    const qr = dataSource.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();

    const event = fakeEvent('checkout.session.completed', {
      id: 'cs_already_failed',
      amount_total: 5000,
      payment_intent: 'pi_already_failed',
      customer_details: { email: 'donor3@example.com' },
    });
    await checkoutCompletedHandler(qr, event);
    await qr.commitTransaction();
    await qr.release();

    const [row] = await dataSource.query('SELECT status FROM orders WHERE id = $1', [orderId]);
    expect(row.status).toBe('failed');

    const outboxRows = await dataSource.query('SELECT * FROM email_outbox WHERE order_id = $1', [orderId]);
    expect(outboxRows).toHaveLength(0);
  });

  it('paymentIntentSucceededHandler transitions pending -> paid and queues the confirmation email when it wins the race against checkout.session.completed', async () => {
    const orderId = await insertOrder({ sessionId: 'cs_pi_wins_race' });
    const qr = dataSource.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();

    const event = fakeEvent('payment_intent.succeeded', {
      id: 'pi_wins_race',
      amount_received: 5000,
      receipt_email: 'donor4@example.com',
      metadata: { orderId },
    });
    const result = await paymentIntentSucceededHandler(qr, event);
    await qr.commitTransaction();
    await qr.release();

    expect(result.orderId).toBe(orderId);
    const [row] = await dataSource.query(
      'SELECT status, donor_email, stripe_payment_intent_id, amount_cents FROM orders WHERE id = $1',
      [orderId],
    );
    expect(row.status).toBe('paid');
    expect(row.donor_email).toBe('donor4@example.com');
    expect(row.stripe_payment_intent_id).toBe('pi_wins_race');
    expect(row.amount_cents).toBe(5000);

    const outboxRows = await dataSource.query('SELECT * FROM email_outbox WHERE order_id = $1', [orderId]);
    expect(outboxRows).toHaveLength(1);
  });

  it('paymentIntentSucceededHandler no-ops when the PaymentIntent carries no orderId metadata', async () => {
    const orderId = await insertOrder({ sessionId: 'cs_pi_no_metadata' });
    const qr = dataSource.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();

    const event = fakeEvent('payment_intent.succeeded', {
      id: 'pi_no_metadata',
      amount_received: 5000,
      metadata: {},
    });
    const result = await paymentIntentSucceededHandler(qr, event);
    await qr.commitTransaction();
    await qr.release();

    expect(result.orderId).toBeNull();
    const [row] = await dataSource.query('SELECT status FROM orders WHERE id = $1', [orderId]);
    expect(row.status).toBe('pending');
  });

  it('paymentIntentSucceededHandler is a no-op (and does not double-queue an email) when checkout.session.completed already won the race', async () => {
    const orderId = await insertOrder({ sessionId: 'cs_pi_loses_race' });
    const qr1 = dataSource.createQueryRunner();
    await qr1.connect();
    await qr1.startTransaction();
    await checkoutCompletedHandler(
      qr1,
      fakeEvent('checkout.session.completed', {
        id: 'cs_pi_loses_race',
        amount_total: 5000,
        payment_intent: 'pi_loses_race',
        customer_details: { email: 'donor5@example.com' },
      }),
    );
    await qr1.commitTransaction();
    await qr1.release();

    const qr2 = dataSource.createQueryRunner();
    await qr2.connect();
    await qr2.startTransaction();
    const result = await paymentIntentSucceededHandler(
      qr2,
      fakeEvent('payment_intent.succeeded', {
        id: 'pi_loses_race',
        amount_received: 5000,
        receipt_email: 'donor5@example.com',
        metadata: { orderId },
      }),
    );
    await qr2.commitTransaction();
    await qr2.release();

    // The order is already identified via metadata.orderId even though the
    // guarded UPDATE affects 0 rows (order already paid) — mirrors
    // checkoutCompletedHandler's "not pending" test above, which likewise
    // returns the matched order's id rather than null.
    expect(result.orderId).toBe(orderId);
    const outboxRows = await dataSource.query('SELECT * FROM email_outbox WHERE order_id = $1', [orderId]);
    expect(outboxRows).toHaveLength(1);
  });
});
