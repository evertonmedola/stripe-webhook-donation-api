import { Test } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import Stripe from 'stripe';
import { OrderEntity } from '../../orders/entities/order.entity';
import { checkoutCompletedHandler } from './checkout-completed.handler';
import { paymentFailedHandler } from './payment-failed.handler';
import { chargeRefundedHandler } from './charge-refunded.handler';

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
});
