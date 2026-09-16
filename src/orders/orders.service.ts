import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryRunner, Repository } from 'typeorm';
import { OrderEntity, OrderStatus } from './entities/order.entity';
import { isValidTransition } from './order-state-machine';

/**
 * Allowlist of column names that transitionAtomic's extraColumns is permitted to set.
 * This list excludes id, status, and updated_at which are managed by the method itself.
 */
export const ALLOWED_EXTRA_COLUMNS = new Set([
  'amount_cents',
  'refunded_amount_cents',
  'currency',
  'stripe_session_id',
  'stripe_payment_intent_id',
  'donor_email',
]);

@Injectable()
export class OrdersService {
  constructor(
    @InjectRepository(OrderEntity)
    private readonly orders: Repository<OrderEntity>,
  ) {}

  async createPendingOrder(input: {
    amountCents: number;
    currency: string;
    stripeSessionId: string;
  }): Promise<OrderEntity> {
    const order = this.orders.create({
      status: 'pending',
      amountCents: input.amountCents,
      currency: input.currency,
      stripeSessionId: input.stripeSessionId,
    });
    return this.orders.save(order);
  }

  async attachStripeSessionId(orderId: string, stripeSessionId: string): Promise<void> {
    await this.orders.update({ id: orderId }, { stripeSessionId });
  }

  async getStatus(orderId: string): Promise<OrderStatus | null> {
    const order = await this.orders.findOne({ where: { id: orderId }, select: ['status'] });
    return order?.status ?? null;
  }

  /**
   * Atomic `UPDATE ... WHERE id = $1 AND status = from`. Returns true if
   * exactly one row was transitioned, false if the WHERE matched nothing
   * (already transitioned or invalid origin state) — a false result is
   * never an error. This is a single statement, never a SELECT-then-UPDATE,
   * so there is no race window between the check and the write.
   */
  async transitionAtomic(
    queryRunner: QueryRunner,
    orderId: string,
    from: OrderStatus,
    to: OrderStatus,
    extraColumns: Record<string, unknown> = {},
  ): Promise<boolean> {
    if (!isValidTransition(from, to)) {
      throw new Error(`Invalid order state transition: ${from} -> ${to}`);
    }

    const extraKeys = Object.keys(extraColumns);

    // Validate that all extraColumns keys are in the allowlist
    for (const key of extraKeys) {
      if (!ALLOWED_EXTRA_COLUMNS.has(key)) {
        throw new Error(`transitionAtomic: extraColumns contains a disallowed column: ${key}`);
      }
    }
    const setClauses = ['status = $3', 'updated_at = now()', ...extraKeys.map((k, i) => `${k} = $${4 + i}`)];
    const params = [orderId, from, to, ...extraKeys.map((k) => extraColumns[k])];

    const result = await queryRunner.query(
      `UPDATE orders SET ${setClauses.join(', ')} WHERE id = $1 AND status = $2`,
      params,
    );
    return extractUpdatedRowCount(result) === 1;
  }
}

/**
 * TypeORM's pg driver QueryRunner.query() for an UPDATE statement returns
 * an array `[rows, rowCount]` where `rows` is `undefined` (no RETURNING
 * clause) and `rowCount` is the number of rows affected — see the
 * row-count investigation in the task-6 report for how this was verified
 * against the installed typeorm/pg versions.
 */
function extractUpdatedRowCount(result: unknown): number {
  if (Array.isArray(result) && typeof result[1] === 'number') {
    return result[1];
  }
  return 0;
}
