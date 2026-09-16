import { Test } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { OrderEntity } from './entities/order.entity';
import { OrdersService } from './orders.service';

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://payment_user:payment_pass@localhost:5434/payment_validation';

describe('OrdersService (integration)', () => {
  let dataSource: DataSource;
  let service: OrdersService;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({
          type: 'postgres',
          url: TEST_DB_URL,
          entities: [OrderEntity],
          synchronize: false,
        }),
        TypeOrmModule.forFeature([OrderEntity]),
      ],
      providers: [OrdersService],
    }).compile();

    dataSource = module.get(DataSource);
    service = module.get(OrdersService);
  });

  afterEach(async () => {
    await dataSource.query('DELETE FROM orders');
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  it('creates a pending order and reads its status back', async () => {
    const order = await service.createPendingOrder({
      amountCents: 5000,
      currency: 'brl',
      stripeSessionId: 'cs_test_1',
    });
    expect(order.status).toBe('pending');

    const status = await service.getStatus(order.id);
    expect(status).toBe('pending');
  });

  it('returns null for an unknown order id', async () => {
    const status = await service.getStatus('00000000-0000-0000-0000-000000000000');
    expect(status).toBeNull();
  });

  it('transitions pending -> paid atomically and rejects a second concurrent attempt', async () => {
    const order = await service.createPendingOrder({
      amountCents: 5000,
      currency: 'brl',
      stripeSessionId: 'cs_test_2',
    });

    const queryRunner = dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    const firstResult = await service.transitionAtomic(queryRunner, order.id, 'pending', 'paid');
    await queryRunner.commitTransaction();
    await queryRunner.release();
    expect(firstResult).toBe(true);

    const queryRunner2 = dataSource.createQueryRunner();
    await queryRunner2.connect();
    await queryRunner2.startTransaction();
    const secondResult = await service.transitionAtomic(queryRunner2, order.id, 'pending', 'paid');
    await queryRunner2.commitTransaction();
    await queryRunner2.release();
    expect(secondResult).toBe(false);

    expect(await service.getStatus(order.id)).toBe('paid');
  });

  it('writes extraColumns (e.g. donor_email) in the same atomic UPDATE', async () => {
    const order = await service.createPendingOrder({
      amountCents: 5000,
      currency: 'brl',
      stripeSessionId: 'cs_test_3',
    });

    const queryRunner = dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    await service.transitionAtomic(queryRunner, order.id, 'pending', 'paid', {
      donor_email: 'donor@example.com',
    });
    await queryRunner.commitTransaction();
    await queryRunner.release();

    const [row] = await dataSource.query('SELECT donor_email FROM orders WHERE id = $1', [order.id]);
    expect(row.donor_email).toBe('donor@example.com');
  });
});
