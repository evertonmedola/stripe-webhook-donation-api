# Payment API (Stripe Webhook) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a NestJS + PostgreSQL payment API for a single-product/donation site, integrated with Stripe Checkout via a webhook that is signature-verified, idempotent, replay-resistant, and drives an auditable `pending -> paid -> failed | refunded` state machine.

**Architecture:** Modular NestJS monolith (`checkout`, `webhooks`, `orders`, `outbox`, `audit-log`, `common`). TypeORM + `pg` against PostgreSQL, using `QueryRunner` transactions for the atomic idempotency+state-transition unit. Frontend is static vanilla HTML/CSS/JS served same-origin via `ServeStaticModule`.

**Tech Stack:** NestJS 10, TypeScript (strict), TypeORM 0.3 + PostgreSQL, `stripe` SDK, `class-validator`/`class-transformer`, `@nestjs/config` + Joi, `@nestjs/throttler`, `@nestjs/schedule`, `helmet`, `nodemailer`, Jest + Supertest.

**Spec:** `docs/superpowers/specs/2026-09-16-payment-api-design.md`

## Global Constraints

- Never persist raw card data or the raw Stripe event payload — only allowlisted fields (spec: Information Disclosure).
- Webhook route reads the **raw body** for signature verification; the global JSON body parser must not touch it first (spec: Tampering / T2).
- Every state transition is an atomic `UPDATE ... WHERE id = $1 AND status = $2`, never read-then-write (spec: state machine).
- `audit_log` writes happen in a transaction/connection **separate** from the main webhook transaction, are best-effort, and fall back to stderr logging on failure — they must never fail the HTTP response (spec: Repudiation).
- `audit_log.detail` is built via an explicit positive allowlist (`event_id`, `event_type`, `order_id`, `status`, `reason`) — never a spread of an error or Stripe event object (spec: Information Disclosure).
- No secret (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, DB credentials, SMTP credentials) is ever logged, at any log level.
- The app must fail to boot if a required env var is missing (Joi validation in `ConfigModule`), never run with a silently-absent secret.
- Currency is always fixed server-side (`brl`); never accepted from the client.
- All public endpoints (`POST /checkout/sessions`, `GET /orders/:id/status`, `POST /webhooks/stripe`) are rate-limited per IP.
- `ValidationPipe` is global with `whitelist: true, forbidNonWhitelisted: true, transform: true`.

---

## File Structure

```
package.json, tsconfig.json, nest-cli.json, jest.config.js
.env.example, .gitignore, docker-compose.yml
src/
  main.ts
  app.module.ts
  common/
    config/env.validation.ts
    filters/http-exception.filter.ts
  database/
    migrations/1700000000000-InitSchema.ts
  orders/
    entities/order.entity.ts
    entities/processed-stripe-event.entity.ts
    order-state-machine.ts
    order-state-machine.spec.ts
    orders.service.ts
    orders.service.spec.ts
    orders.controller.ts
    orders.controller.spec.ts
    orders.module.ts
  audit-log/
    entities/audit-log.entity.ts
    audit-log.service.ts
    audit-log.service.spec.ts
    audit-log.module.ts
  checkout/
    dto/create-checkout-session.dto.ts
    dto/create-checkout-session.dto.spec.ts
    stripe.provider.ts
    checkout.service.ts
    checkout.service.spec.ts
    checkout.controller.ts
    checkout.controller.spec.ts
    checkout.module.ts
  webhooks/
    stripe-webhook.controller.ts
    stripe-webhook.controller.spec.ts
    stripe-webhook.service.ts
    stripe-webhook.service.spec.ts
    handlers/checkout-completed.handler.ts
    handlers/payment-failed.handler.ts
    handlers/charge-refunded.handler.ts
    handlers/webhook-handlers.spec.ts
    webhooks.module.ts
  outbox/
    entities/email-outbox.entity.ts
    mail.provider.ts
    email-outbox.service.ts
    email-outbox.service.spec.ts
    email-outbox.processor.ts
    outbox.module.ts
public/
  index.html
  success.html
  cancel.html
  style.css
  checkout.js
  status-poll.js
```

---

### Task 1: Project scaffolding, dependencies, and env config

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `nest-cli.json`
- Create: `jest.config.js`
- Create: `.gitignore`
- Create: `.env.example`
- Create: `docker-compose.yml`
- Create: `src/main.ts`
- Create: `src/app.module.ts`
- Create: `src/common/config/env.validation.ts`
- Test: `src/common/config/env.validation.spec.ts`

**Interfaces:**
- Produces: `envValidationSchema: Joi.ObjectSchema` (exported from `src/common/config/env.validation.ts`), consumed by `ConfigModule.forRoot({ validationSchema: envValidationSchema })` in `app.module.ts`.

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "payment-validation-api",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "build": "nest build",
    "start": "nest start",
    "start:dev": "nest start --watch",
    "test": "jest",
    "test:watch": "jest --watch",
    "typeorm": "typeorm-ts-node-commonjs"
  },
  "dependencies": {
    "@nestjs/common": "^10.4.0",
    "@nestjs/config": "^3.2.0",
    "@nestjs/core": "^10.4.0",
    "@nestjs/platform-express": "^10.4.0",
    "@nestjs/schedule": "^4.1.0",
    "@nestjs/serve-static": "^4.0.2",
    "@nestjs/throttler": "^5.1.2",
    "@nestjs/typeorm": "^10.0.2",
    "class-transformer": "^0.5.1",
    "class-validator": "^0.14.1",
    "helmet": "^7.1.0",
    "joi": "^17.13.1",
    "nodemailer": "^6.9.14",
    "pg": "^8.12.0",
    "reflect-metadata": "^0.2.2",
    "rxjs": "^7.8.1",
    "stripe": "^16.8.0",
    "typeorm": "^0.3.20"
  },
  "devDependencies": {
    "@nestjs/cli": "^10.4.5",
    "@nestjs/testing": "^10.4.0",
    "@types/express": "^4.17.21",
    "@types/jest": "^29.5.12",
    "@types/node": "^20.14.0",
    "@types/nodemailer": "^6.4.15",
    "@types/supertest": "^6.0.2",
    "jest": "^29.7.0",
    "supertest": "^6.3.4",
    "ts-jest": "^29.2.4",
    "ts-node": "^10.9.2",
    "typescript": "^5.5.4"
  }
}
```

- [ ] **Step 2: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "module": "commonjs",
    "declaration": false,
    "target": "ES2021",
    "outDir": "./dist",
    "baseUrl": "./",
    "incremental": true,
    "strict": true,
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "sourceMap": true,
    "skipLibCheck": true,
    "esModuleInterop": true
  }
}
```

- [ ] **Step 3: Write `nest-cli.json`**

```json
{
  "$schema": "https://json.schemastore.org/nest-cli",
  "collection": "@nestjs/schematics",
  "sourceRoot": "src"
}
```

- [ ] **Step 4: Write `jest.config.js`**

```js
module.exports = {
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  transform: { '^.+\\.(t|j)s$': 'ts-jest' },
  collectCoverageFrom: ['**/*.(t|j)s'],
  testEnvironment: 'node',
};
```

- [ ] **Step 5: Write `.gitignore`**

```
node_modules/
dist/
.env
*.log
```

- [ ] **Step 6: Write `.env.example`**

```
PORT=3000
DATABASE_URL=postgres://payment_user:payment_pass@localhost:5432/payment_validation
STRIPE_SECRET_KEY=sk_test_placeholder
STRIPE_WEBHOOK_SECRET=whsec_placeholder
STRIPE_ALLOWED_PRICE_IDS=price_placeholder1,price_placeholder2
MIN_DONATION_CENTS=500
MAX_DONATION_CENTS=100000000
FRONTEND_ORIGIN=http://localhost:3000
OUTBOX_MAX_ATTEMPTS=5
SMTP_HOST=localhost
SMTP_PORT=1025
SMTP_USER=
SMTP_PASS=
SMTP_FROM=doacoes@example.com
```

- [ ] **Step 7: Write `docker-compose.yml`** (local Postgres for dev/test)

```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: payment_user
      POSTGRES_PASSWORD: payment_pass
      POSTGRES_DB: payment_validation
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
volumes:
  pgdata:
```

- [ ] **Step 8: Write the failing test for env validation**

```typescript
// src/common/config/env.validation.spec.ts
import { envValidationSchema } from './env.validation';

describe('envValidationSchema', () => {
  const validEnv = {
    PORT: '3000',
    DATABASE_URL: 'postgres://u:p@localhost:5432/db',
    STRIPE_SECRET_KEY: 'sk_test_x',
    STRIPE_WEBHOOK_SECRET: 'whsec_x',
    STRIPE_ALLOWED_PRICE_IDS: 'price_a,price_b',
    MIN_DONATION_CENTS: '500',
    MAX_DONATION_CENTS: '100000',
    FRONTEND_ORIGIN: 'http://localhost:3000',
    OUTBOX_MAX_ATTEMPTS: '5',
    SMTP_HOST: 'localhost',
    SMTP_PORT: '1025',
    SMTP_FROM: 'a@b.com',
  };

  it('passes with all required vars present', () => {
    const { error } = envValidationSchema.validate(validEnv);
    expect(error).toBeUndefined();
  });

  it('fails when STRIPE_WEBHOOK_SECRET is missing', () => {
    const { STRIPE_WEBHOOK_SECRET, ...rest } = validEnv;
    const { error } = envValidationSchema.validate(rest);
    expect(error).toBeDefined();
    expect(error!.message).toContain('STRIPE_WEBHOOK_SECRET');
  });
});
```

- [ ] **Step 9: Run test to verify it fails**

Run: `npx jest env.validation.spec.ts`
Expected: FAIL — `Cannot find module './env.validation'`

- [ ] **Step 10: Write `src/common/config/env.validation.ts`**

```typescript
import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  PORT: Joi.number().default(3000),
  DATABASE_URL: Joi.string().uri().required(),
  STRIPE_SECRET_KEY: Joi.string().required(),
  STRIPE_WEBHOOK_SECRET: Joi.string().required(),
  STRIPE_ALLOWED_PRICE_IDS: Joi.string().required(),
  MIN_DONATION_CENTS: Joi.number().integer().min(1).required(),
  MAX_DONATION_CENTS: Joi.number().integer().min(Joi.ref('MIN_DONATION_CENTS')).required(),
  FRONTEND_ORIGIN: Joi.string().uri().required(),
  OUTBOX_MAX_ATTEMPTS: Joi.number().integer().min(1).default(5),
  SMTP_HOST: Joi.string().required(),
  SMTP_PORT: Joi.number().required(),
  SMTP_USER: Joi.string().allow('').default(''),
  SMTP_PASS: Joi.string().allow('').default(''),
  SMTP_FROM: Joi.string().required(),
});
```

- [ ] **Step 11: Run test to verify it passes**

Run: `npx jest env.validation.spec.ts`
Expected: PASS (2 tests)

- [ ] **Step 12: Write `src/app.module.ts`** (minimal for now, extended in later tasks)

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { envValidationSchema } from './common/config/env.validation';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: envValidationSchema,
    }),
  ],
})
export class AppModule {}
```

- [ ] **Step 13: Write `src/main.ts`** (minimal for now, extended in Task 9)

```typescript
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
```

- [ ] **Step 14: Install dependencies and verify the app boots**

Run: `npm install`
Run: `docker compose up -d`
Run: `npm run start:dev` then Ctrl+C once "Nest application successfully started" appears — confirms env validation and boot work end-to-end.

- [ ] **Step 15: Commit**

```bash
git add package.json tsconfig.json nest-cli.json jest.config.js .gitignore .env.example docker-compose.yml src/main.ts src/app.module.ts src/common/config/env.validation.ts src/common/config/env.validation.spec.ts
git commit -m "chore: scaffold NestJS project with validated env config"
```

---

### Task 2: Database schema (TypeORM entities + migration)

**Files:**
- Create: `src/orders/entities/order.entity.ts`
- Create: `src/orders/entities/processed-stripe-event.entity.ts`
- Create: `src/audit-log/entities/audit-log.entity.ts`
- Create: `src/outbox/entities/email-outbox.entity.ts`
- Create: `src/database/data-source.ts`
- Create: `src/database/migrations/1700000000000-InitSchema.ts`
- Modify: `src/app.module.ts`
- Modify: `package.json` (add `typeorm` config path already present via script)

**Interfaces:**
- Produces: `OrderEntity` with fields `id: string, status: 'pending'|'paid'|'failed'|'refunded', amountCents: number, refundedAmountCents: number, currency: string, stripeSessionId: string, stripePaymentIntentId: string | null, donorEmail: string | null, createdAt: Date, updatedAt: Date`.
- Produces: `ProcessedStripeEventEntity` with fields `eventId: string, eventType: string, orderId: string | null, receivedAt: Date, outcome: 'processed'|'rejected'|'duplicate'`.
- Produces: `AuditLogEntity` with fields `id: number, eventId: string | null, orderId: string | null, action: string, detail: Record<string, unknown>, createdAt: Date`.
- Produces: `EmailOutboxEntity` with fields `id: number, orderId: string, status: 'pending'|'sent'|'failed', attempts: number, lastError: string | null, createdAt: Date, sentAt: Date | null`.

- [ ] **Step 1: Write `src/orders/entities/order.entity.ts`**

```typescript
import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export type OrderStatus = 'pending' | 'paid' | 'failed' | 'refunded';

@Entity('orders')
export class OrderEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', default: 'pending' })
  status!: OrderStatus;

  @Column({ name: 'amount_cents', type: 'integer' })
  amountCents!: number;

  @Column({ name: 'refunded_amount_cents', type: 'integer', default: 0 })
  refundedAmountCents!: number;

  @Column({ type: 'varchar', length: 3, default: 'brl' })
  currency!: string;

  @Column({ name: 'stripe_session_id', type: 'varchar', unique: true })
  stripeSessionId!: string;

  @Column({ name: 'stripe_payment_intent_id', type: 'varchar', unique: true, nullable: true })
  stripePaymentIntentId!: string | null;

  @Column({ name: 'donor_email', type: 'varchar', nullable: true })
  donorEmail!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
```

- [ ] **Step 2: Write `src/orders/entities/processed-stripe-event.entity.ts`**

```typescript
import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

export type ProcessedEventOutcome = 'processed' | 'rejected' | 'duplicate';

@Entity('processed_stripe_events')
export class ProcessedStripeEventEntity {
  @PrimaryColumn({ name: 'event_id', type: 'varchar' })
  eventId!: string;

  @Column({ name: 'event_type', type: 'varchar' })
  eventType!: string;

  @Column({ name: 'order_id', type: 'uuid', nullable: true })
  orderId!: string | null;

  @CreateDateColumn({ name: 'received_at', type: 'timestamptz' })
  receivedAt!: Date;

  @Column({ type: 'varchar' })
  outcome!: ProcessedEventOutcome;
}
```

- [ ] **Step 3: Write `src/audit-log/entities/audit-log.entity.ts`**

```typescript
import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('audit_log')
export class AuditLogEntity {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id!: string;

  @Column({ name: 'event_id', type: 'varchar', nullable: true })
  eventId!: string | null;

  @Column({ name: 'order_id', type: 'uuid', nullable: true })
  orderId!: string | null;

  @Column({ type: 'varchar' })
  action!: string;

  @Column({ type: 'jsonb' })
  detail!: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
```

- [ ] **Step 4: Write `src/outbox/entities/email-outbox.entity.ts`**

```typescript
import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

export type EmailOutboxStatus = 'pending' | 'sent' | 'failed';

@Entity('email_outbox')
export class EmailOutboxEntity {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id!: string;

  @Column({ name: 'order_id', type: 'uuid' })
  orderId!: string;

  @Column({ type: 'varchar', default: 'pending' })
  status!: EmailOutboxStatus;

  @Column({ type: 'integer', default: 0 })
  attempts!: number;

  @Column({ name: 'last_error', type: 'text', nullable: true })
  lastError!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @Column({ name: 'sent_at', type: 'timestamptz', nullable: true })
  sentAt!: Date | null;
}
```

- [ ] **Step 5: Write `src/database/data-source.ts`** (used by both the migration CLI and `TypeOrmModule`)

```typescript
import 'reflect-metadata';
import { DataSource, DataSourceOptions } from 'typeorm';
import { OrderEntity } from '../orders/entities/order.entity';
import { ProcessedStripeEventEntity } from '../orders/entities/processed-stripe-event.entity';
import { AuditLogEntity } from '../audit-log/entities/audit-log.entity';
import { EmailOutboxEntity } from '../outbox/entities/email-outbox.entity';

export const buildDataSourceOptions = (databaseUrl: string): DataSourceOptions => ({
  type: 'postgres',
  url: databaseUrl,
  entities: [OrderEntity, ProcessedStripeEventEntity, AuditLogEntity, EmailOutboxEntity],
  migrations: [__dirname + '/migrations/*.{ts,js}'],
  synchronize: false,
});

export default new DataSource(
  buildDataSourceOptions(process.env.DATABASE_URL ?? 'postgres://payment_user:payment_pass@localhost:5432/payment_validation'),
);
```

- [ ] **Step 6: Write `src/database/migrations/1700000000000-InitSchema.ts`**

```typescript
import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitSchema1700000000000 implements MigrationInterface {
  name = 'InitSchema1700000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`);

    await queryRunner.query(`
      CREATE TABLE orders (
        id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        status                    varchar NOT NULL DEFAULT 'pending'
                                  CHECK (status IN ('pending','paid','failed','refunded')),
        amount_cents              integer NOT NULL,
        refunded_amount_cents     integer NOT NULL DEFAULT 0,
        currency                  varchar(3) NOT NULL DEFAULT 'brl',
        stripe_session_id         varchar UNIQUE NOT NULL,
        stripe_payment_intent_id  varchar UNIQUE NULL,
        donor_email               varchar NULL,
        created_at                timestamptz NOT NULL DEFAULT now(),
        updated_at                timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE TABLE processed_stripe_events (
        event_id      varchar PRIMARY KEY,
        event_type    varchar NOT NULL,
        order_id      uuid NULL REFERENCES orders(id),
        received_at   timestamptz NOT NULL DEFAULT now(),
        outcome       varchar NOT NULL CHECK (outcome IN ('processed','rejected','duplicate'))
      )
    `);

    await queryRunner.query(`
      CREATE TABLE audit_log (
        id          bigserial PRIMARY KEY,
        event_id    varchar NULL,
        order_id    uuid NULL REFERENCES orders(id),
        action      varchar NOT NULL,
        detail      jsonb NOT NULL,
        created_at  timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE TABLE email_outbox (
        id          bigserial PRIMARY KEY,
        order_id    uuid NOT NULL REFERENCES orders(id),
        status      varchar NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','sent','failed')),
        attempts    integer NOT NULL DEFAULT 0,
        last_error  text NULL,
        created_at  timestamptz NOT NULL DEFAULT now(),
        sent_at     timestamptz NULL
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE email_outbox`);
    await queryRunner.query(`DROP TABLE audit_log`);
    await queryRunner.query(`DROP TABLE processed_stripe_events`);
    await queryRunner.query(`DROP TABLE orders`);
  }
}
```

- [ ] **Step 7: Add migration scripts to `package.json`** (`scripts` block)

```json
"typeorm:run": "typeorm-ts-node-commonjs migration:run -d src/database/data-source.ts",
"typeorm:revert": "typeorm-ts-node-commonjs migration:revert -d src/database/data-source.ts"
```

- [ ] **Step 8: Run the migration against the local dev DB**

Run: `docker compose up -d`
Run: `npm run typeorm:run`
Expected: output confirms `InitSchema1700000000000` migration executed; connect with `psql` or a client and confirm the four tables exist.

- [ ] **Step 9: Wire `TypeOrmModule` into `src/app.module.ts`**

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { envValidationSchema } from './common/config/env.validation';
import { buildDataSourceOptions } from './database/data-source';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validationSchema: envValidationSchema }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        buildDataSourceOptions(config.get<string>('DATABASE_URL')!),
    }),
  ],
})
export class AppModule {}
```

- [ ] **Step 10: Verify the app still boots with the DB connected**

Run: `npm run start:dev` then Ctrl+C once started without connection errors.

- [ ] **Step 11: Commit**

```bash
git add src/orders/entities src/audit-log/entities src/outbox/entities src/database src/app.module.ts package.json
git commit -m "feat: add TypeORM entities and initial schema migration"
```

---

### Task 3: Order state machine (pure, no DB)

**This is the most safety-critical unit in the system — it is the single place that decides which state transitions are legal. Full branch coverage is required before moving on.**

**Files:**
- Create: `src/orders/order-state-machine.ts`
- Test: `src/orders/order-state-machine.spec.ts`

**Interfaces:**
- Produces: `type OrderStatus = 'pending' | 'paid' | 'failed' | 'refunded'` (re-exported from `order.entity.ts`, Task 2)
- Produces: `isValidTransition(from: OrderStatus, to: OrderStatus): boolean`
- Produces: `ALLOWED_TRANSITIONS: Record<OrderStatus, OrderStatus[]>`

- [ ] **Step 1: Write the failing test**

```typescript
// src/orders/order-state-machine.spec.ts
import { isValidTransition } from './order-state-machine';

describe('isValidTransition', () => {
  it.each([
    ['pending', 'paid'],
    ['pending', 'failed'],
    ['paid', 'refunded'],
  ] as const)('allows %s -> %s', (from, to) => {
    expect(isValidTransition(from, to)).toBe(true);
  });

  it.each([
    ['paid', 'pending'],
    ['refunded', 'paid'],
    ['failed', 'paid'],
    ['pending', 'refunded'],
    ['refunded', 'refunded'],
    ['pending', 'pending'],
  ] as const)('rejects %s -> %s', (from, to) => {
    expect(isValidTransition(from, to)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest order-state-machine.spec.ts`
Expected: FAIL — `Cannot find module './order-state-machine'`

- [ ] **Step 3: Write `src/orders/order-state-machine.ts`**

```typescript
import { OrderStatus } from './entities/order.entity';

export const ALLOWED_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  pending: ['paid', 'failed'],
  paid: ['refunded'],
  failed: [],
  refunded: [],
};

export function isValidTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest order-state-machine.spec.ts`
Expected: PASS (9 tests)

- [ ] **Step 5: Commit**

```bash
git add src/orders/order-state-machine.ts src/orders/order-state-machine.spec.ts
git commit -m "feat: add order state machine with exhaustive transition tests"
```

---

### Task 4 (Security Checkpoint 1): Review state machine coverage

**This is a checkpoint, not a code task — run it before building anything that depends on the state machine.**

- [ ] **Step 1: Invoke the `security-review` skill** against the diff introduced in Tasks 1-3, focused on: does `ALLOWED_TRANSITIONS` match exactly the three transitions in the spec's state machine section, with no accidental extra edge (e.g. no path back from `refunded` or `failed`)? Confirm every branch in `order-state-machine.spec.ts` is exercised (`pending->paid`, `pending->failed`, `paid->refunded`, and all 6 rejected pairs).
- [ ] **Step 2: Record the outcome.** If the review finds no issues, note "Checkpoint 1: passed" in the task tracker/commit message of the next task. If it finds issues, fix them in `order-state-machine.ts`/its spec, re-run Step 4 of Task 3, and re-review before proceeding.

---

### Task 5: Audit log service (write-only, allowlist serializer, separate transaction)

**Files:**
- Create: `src/audit-log/audit-log.service.ts`
- Create: `src/audit-log/audit-log.module.ts`
- Test: `src/audit-log/audit-log.service.spec.ts`

**Interfaces:**
- Consumes: `AuditLogEntity` (Task 2), `DataSource` from `typeorm`.
- Produces: `AuditLogService.record(entry: AuditLogEntry): Promise<void>` where
  `interface AuditLogEntry { eventId?: string; orderId?: string; action: string; eventType?: string; status?: string; reason?: string }`.
  `record` never throws — internal failures are caught and logged to stderr via `Logger.error`.

- [ ] **Step 1: Write the failing test**

```typescript
// src/audit-log/audit-log.service.spec.ts
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { AuditLogService } from './audit-log.service';

describe('AuditLogService', () => {
  let service: AuditLogService;
  let dataSource: { query: jest.Mock };

  beforeEach(async () => {
    dataSource = { query: jest.fn().mockResolvedValue(undefined) };
    const module = await Test.createTestingModule({
      providers: [AuditLogService, { provide: DataSource, useValue: dataSource }],
    }).compile();
    service = module.get(AuditLogService);
  });

  it('writes only allowlisted fields to detail, dropping anything else', async () => {
    await service.record({
      eventId: 'evt_1',
      orderId: 'order_1',
      action: 'order_transitioned',
      status: 'paid',
      reason: 'ignored-field-should-not-leak',
      // @ts-expect-error intentionally passing a disallowed field to prove it is dropped
      secretCardNumber: '4242424242424242',
    } as never);

    expect(dataSource.query).toHaveBeenCalledTimes(1);
    const [, params] = dataSource.query.mock.calls[0];
    const detailJson = JSON.stringify(params[3]);
    expect(detailJson).not.toContain('secretCardNumber');
    expect(detailJson).not.toContain('4242424242424242');
  });

  it('never throws when the underlying write fails', async () => {
    dataSource.query.mockRejectedValue(new Error('db down'));
    await expect(
      service.record({ action: 'signature_invalid' }),
    ).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest audit-log.service.spec.ts`
Expected: FAIL — `Cannot find module './audit-log.service'`

- [ ] **Step 3: Write `src/audit-log/audit-log.service.ts`**

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';

export interface AuditLogEntry {
  eventId?: string;
  orderId?: string;
  eventType?: string;
  status?: string;
  reason?: string;
  action: string;
}

@Injectable()
export class AuditLogService {
  private readonly logger = new Logger(AuditLogService.name);

  constructor(private readonly dataSource: DataSource) {}

  async record(entry: AuditLogEntry): Promise<void> {
    const detail: Record<string, unknown> = {};
    if (entry.eventId !== undefined) detail.event_id = entry.eventId;
    if (entry.eventType !== undefined) detail.event_type = entry.eventType;
    if (entry.orderId !== undefined) detail.order_id = entry.orderId;
    if (entry.status !== undefined) detail.status = entry.status;
    if (entry.reason !== undefined) detail.reason = entry.reason;

    try {
      await this.dataSource.query(
        `INSERT INTO audit_log (event_id, order_id, action, detail) VALUES ($1, $2, $3, $4)`,
        [entry.eventId ?? null, entry.orderId ?? null, entry.action, detail],
      );
    } catch (err) {
      this.logger.error(
        `audit_log write failed (best-effort, not fatal): action=${entry.action} error=${(err as Error).message}`,
      );
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest audit-log.service.spec.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Write `src/audit-log/audit-log.module.ts`**

```typescript
import { Module } from '@nestjs/common';
import { AuditLogService } from './audit-log.service';

@Module({
  providers: [AuditLogService],
  exports: [AuditLogService],
})
export class AuditLogModule {}
```

- [ ] **Step 6: Commit**

```bash
git add src/audit-log
git commit -m "feat: add audit log service with positive-allowlist serializer"
```

---

### Task 6: Orders service — atomic transitions + status lookup

**Files:**
- Create: `src/orders/orders.service.ts`
- Create: `src/orders/orders.module.ts`
- Test: `src/orders/orders.service.spec.ts` (integration test against the real local Postgres from `docker-compose.yml`)

**Interfaces:**
- Consumes: `OrderEntity` (Task 2), `isValidTransition` (Task 3, used defensively inside the service), `DataSource`/`QueryRunner` from `typeorm`.
- Produces:
  - `OrdersService.createPendingOrder(input: { amountCents: number; currency: string; stripeSessionId: string }): Promise<OrderEntity>`
  - `OrdersService.attachStripeSessionId(orderId: string, stripeSessionId: string): Promise<void>` (used if session id must be set after Stripe call — see Task 9)
  - `OrdersService.transitionAtomic(queryRunner: QueryRunner, orderId: string, from: OrderStatus, to: OrderStatus, extraColumns?: Record<string, unknown>): Promise<boolean>` — returns `true` if exactly one row was updated, `false` if the `WHERE` matched zero rows (no-op, not an error).
  - `OrdersService.getStatus(orderId: string): Promise<OrderStatus | null>` — `null` if no such order.

- [ ] **Step 1: Write the failing test**

```typescript
// src/orders/orders.service.spec.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker compose up -d && npm run typeorm:run && npx jest orders.service.spec.ts`
Expected: FAIL — `Cannot find module './orders.service'`

- [ ] **Step 3: Write `src/orders/orders.service.ts`**

```typescript
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryRunner, Repository } from 'typeorm';
import { OrderEntity, OrderStatus } from './entities/order.entity';

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

  async getStatus(orderId: string): Promise<OrderStatus | null> {
    const order = await this.orders.findOne({ where: { id: orderId }, select: ['status'] });
    return order?.status ?? null;
  }

  /**
   * Atomic `UPDATE ... WHERE status = from`. Returns true if the row was
   * transitioned, false if the WHERE matched nothing (already transitioned
   * or invalid origin state) — a false result is never an error.
   */
  async transitionAtomic(
    queryRunner: QueryRunner,
    orderId: string,
    from: OrderStatus,
    to: OrderStatus,
    extraColumns: Record<string, unknown> = {},
  ): Promise<boolean> {
    const extraKeys = Object.keys(extraColumns);
    const setClauses = ['status = $3', 'updated_at = now()', ...extraKeys.map((k, i) => `${k} = $${4 + i}`)];
    const params = [orderId, from, to, ...extraKeys.map((k) => extraColumns[k])];

    const result = await queryRunner.query(
      `UPDATE orders SET ${setClauses.join(', ')} WHERE id = $1 AND status = $2`,
      params,
    );
    return result[1] === 1; // pg driver via TypeORM QueryRunner returns [rows, rowCount] for UPDATE
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest orders.service.spec.ts`
Expected: PASS (4 tests). If `result[1]` shape is wrong for the installed TypeORM/pg version, inspect the actual return value of `queryRunner.query()` for an `UPDATE` and adjust the row-count extraction accordingly — the test's assertions on `true`/`false` are the source of truth, not the shape guess above.

- [ ] **Step 5: Write `src/orders/orders.module.ts`**

```typescript
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OrderEntity } from './entities/order.entity';
import { OrdersService } from './orders.service';

@Module({
  imports: [TypeOrmModule.forFeature([OrderEntity])],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
```

- [ ] **Step 6: Commit**

```bash
git add src/orders/orders.service.ts src/orders/orders.service.spec.ts src/orders/orders.module.ts
git commit -m "feat: add OrdersService with atomic WHERE-guarded state transitions"
```

---

### Task 7: `GET /orders/:id/status` endpoint

**Files:**
- Create: `src/orders/orders.controller.ts`
- Modify: `src/orders/orders.module.ts`
- Test: `src/orders/orders.controller.spec.ts`

**Interfaces:**
- Consumes: `OrdersService.getStatus` (Task 6).
- Produces: `GET /orders/:id/status` → `200 { status: OrderStatus }` or `404` if unknown, `400` if `:id` is not a UUID. Response body never contains `amountCents`, `donorEmail`, or any Stripe id.

- [ ] **Step 1: Write the failing test**

```typescript
// src/orders/orders.controller.spec.ts
import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

describe('OrdersController', () => {
  let controller: OrdersController;
  let service: { getStatus: jest.Mock };

  beforeEach(async () => {
    service = { getStatus: jest.fn() };
    const module = await Test.createTestingModule({
      controllers: [OrdersController],
      providers: [{ provide: OrdersService, useValue: service }],
    }).compile();
    controller = module.get(OrdersController);
  });

  it('returns only the status field for a known order', async () => {
    service.getStatus.mockResolvedValue('paid');
    const result = await controller.getStatus('11111111-1111-1111-1111-111111111111');
    expect(result).toEqual({ status: 'paid' });
  });

  it('throws NotFoundException for an unknown order', async () => {
    service.getStatus.mockResolvedValue(null);
    await expect(
      controller.getStatus('11111111-1111-1111-1111-111111111111'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest orders.controller.spec.ts`
Expected: FAIL — `Cannot find module './orders.controller'`

- [ ] **Step 3: Write `src/orders/orders.controller.ts`**

```typescript
import { Controller, Get, NotFoundException, Param, ParseUUIDPipe } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { OrdersService } from './orders.service';

@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Get(':id/status')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async getStatus(@Param('id', ParseUUIDPipe) id: string): Promise<{ status: string }> {
    const status = await this.ordersService.getStatus(id);
    if (!status) {
      throw new NotFoundException();
    }
    return { status };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest orders.controller.spec.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Register the controller in `src/orders/orders.module.ts`**

```typescript
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OrderEntity } from './entities/order.entity';
import { OrdersService } from './orders.service';
import { OrdersController } from './orders.controller';

@Module({
  imports: [TypeOrmModule.forFeature([OrderEntity])],
  controllers: [OrdersController],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
```

- [ ] **Step 6: Commit**

```bash
git add src/orders/orders.controller.ts src/orders/orders.controller.spec.ts src/orders/orders.module.ts
git commit -m "feat: add GET /orders/:id/status endpoint (status-only response)"
```

---

### Task 8: Checkout DTO with cross-field validation

**Files:**
- Create: `src/checkout/dto/create-checkout-session.dto.ts`
- Test: `src/checkout/dto/create-checkout-session.dto.spec.ts`

**Interfaces:**
- Produces: `class CreateCheckoutSessionDto { productType: 'fixed' | 'custom'; priceId?: string; amountCents?: number }`, validated with `class-validator` decorators including `@ValidateIf`.

- [ ] **Step 1: Write the failing test**

```typescript
// src/checkout/dto/create-checkout-session.dto.spec.ts
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateCheckoutSessionDto } from './create-checkout-session.dto';

async function validateDto(input: Record<string, unknown>) {
  const dto = plainToInstance(CreateCheckoutSessionDto, input);
  return validate(dto);
}

describe('CreateCheckoutSessionDto', () => {
  it('accepts a valid fixed-price payload', async () => {
    const errors = await validateDto({ productType: 'fixed', priceId: 'price_123' });
    expect(errors).toHaveLength(0);
  });

  it('accepts a valid custom-amount payload', async () => {
    const errors = await validateDto({ productType: 'custom', amountCents: 5000 });
    expect(errors).toHaveLength(0);
  });

  it('rejects fixed without priceId', async () => {
    const errors = await validateDto({ productType: 'fixed' });
    expect(errors.some((e) => e.property === 'priceId')).toBe(true);
  });

  it('rejects fixed with amountCents present', async () => {
    const errors = await validateDto({ productType: 'fixed', priceId: 'price_123', amountCents: 5000 });
    expect(errors.some((e) => e.property === 'amountCents')).toBe(true);
  });

  it('rejects custom without amountCents', async () => {
    const errors = await validateDto({ productType: 'custom' });
    expect(errors.some((e) => e.property === 'amountCents')).toBe(true);
  });

  it('rejects custom with priceId present', async () => {
    const errors = await validateDto({ productType: 'custom', amountCents: 5000, priceId: 'price_123' });
    expect(errors.some((e) => e.property === 'priceId')).toBe(true);
  });

  it('rejects a non-integer amountCents', async () => {
    const errors = await validateDto({ productType: 'custom', amountCents: 50.5 });
    expect(errors.some((e) => e.property === 'amountCents')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest create-checkout-session.dto.spec.ts`
Expected: FAIL — `Cannot find module './create-checkout-session.dto'`

- [ ] **Step 3: Write `src/checkout/dto/create-checkout-session.dto.ts`**

```typescript
import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, ValidateIf } from 'class-validator';

export class CreateCheckoutSessionDto {
  @IsIn(['fixed', 'custom'])
  productType!: 'fixed' | 'custom';

  @ValidateIf((o) => o.productType === 'fixed')
  @IsString()
  @IsNotEmpty()
  priceId?: string;

  @ValidateIf((o) => o.productType === 'custom')
  @IsInt()
  amountCents?: number;

  @ValidateIf((o) => o.productType === 'fixed' && o.amountCents !== undefined)
  @IsIn([], { message: 'amountCents must not be provided when productType is fixed' })
  private readonly _rejectAmountWhenFixed?: never;

  @ValidateIf((o) => o.productType === 'custom' && o.priceId !== undefined)
  @IsIn([], { message: 'priceId must not be provided when productType is custom' })
  private readonly _rejectPriceIdWhenCustom?: never;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest create-checkout-session.dto.spec.ts`
Expected: PASS (7 tests). If the `_reject*` sentinel-field trick does not surface errors under the property name `amountCents`/`priceId` as the test expects, replace it with a class-level `@ValidateIf`-free approach: a custom `@Validate(CrossFieldConstraint)` validator class implementing `ValidatorConstraintInterface` that inspects `productType`, `priceId`, and `amountCents` together and reports the offending property explicitly. Keep whichever implementation makes all 7 assertions pass without weakening any of them.

- [ ] **Step 5: Commit**

```bash
git add src/checkout/dto
git commit -m "feat: add checkout DTO with cross-field productType validation"
```

---

### Task 9: Stripe provider + Checkout service (session creation)

**Files:**
- Create: `src/checkout/stripe.provider.ts`
- Create: `src/checkout/checkout.service.ts`
- Test: `src/checkout/checkout.service.spec.ts`

**Interfaces:**
- Consumes: `OrdersService.createPendingOrder` (Task 6), `CreateCheckoutSessionDto` (Task 8), `ConfigService` from `@nestjs/config`.
- Produces: `STRIPE_CLIENT` injection token (a `Stripe` instance) from `stripe.provider.ts`.
- Produces: `CheckoutService.createSession(dto: CreateCheckoutSessionDto): Promise<{ checkoutUrl: string }>`. Throws `BadRequestException` if `productType='fixed'` and `priceId` is not in the `STRIPE_ALLOWED_PRICE_IDS` allowlist, or if `productType='custom'` and `amountCents` is outside `[MIN_DONATION_CENTS, MAX_DONATION_CENTS]`.

- [ ] **Step 1: Write `src/checkout/stripe.provider.ts`**

```typescript
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';

export const STRIPE_CLIENT = 'STRIPE_CLIENT';

export const stripeClientProvider = {
  provide: STRIPE_CLIENT,
  inject: [ConfigService],
  useFactory: (config: ConfigService) =>
    new Stripe(config.get<string>('STRIPE_SECRET_KEY')!, { apiVersion: '2024-06-20' }),
};
```

- [ ] **Step 2: Write the failing test for `CheckoutService`**

```typescript
// src/checkout/checkout.service.spec.ts
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BadRequestException } from '@nestjs/common';
import { CheckoutService } from './checkout.service';
import { OrdersService } from '../orders/orders.service';
import { STRIPE_CLIENT } from './stripe.provider';

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
  });

  it('rejects a custom amount above the maximum', async () => {
    await expect(
      service.createSession({ productType: 'custom', amountCents: 999_999_999 }),
    ).rejects.toBeInstanceOf(BadRequestException);
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
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx jest checkout.service.spec.ts`
Expected: FAIL — `Cannot find module './checkout.service'`

- [ ] **Step 4: Write `src/checkout/checkout.service.ts`**

```typescript
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

    const min = Number(this.config.get<string>('MIN_DONATION_CENTS'));
    const max = Number(this.config.get<string>('MAX_DONATION_CENTS'));
    if (dto.amountCents! < min || dto.amountCents! > max) {
      throw new BadRequestException(`amountCents must be between ${min} and ${max}`);
    }
    return dto.amountCents!;
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx jest checkout.service.spec.ts`
Expected: PASS (6 tests)

- [ ] **Step 6: Add `attachStripeSessionId` to `OrdersService` (Task 6 left it as an interface stub — implement it now)**

Modify `src/orders/orders.service.ts`, add:

```typescript
  async attachStripeSessionId(orderId: string, stripeSessionId: string): Promise<void> {
    await this.orders.update({ id: orderId }, { stripeSessionId });
  }
```

- [ ] **Step 7: Run the full orders + checkout test suites to confirm nothing regressed**

Run: `npx jest orders.service.spec.ts checkout.service.spec.ts`
Expected: PASS (all)

- [ ] **Step 8: Commit**

```bash
git add src/checkout/stripe.provider.ts src/checkout/checkout.service.ts src/checkout/checkout.service.spec.ts src/orders/orders.service.ts
git commit -m "feat: add CheckoutService creating pending orders and Stripe sessions"
```

**Note for the fixed-price path:** `amountCents` is stored as `0` for `fixed` orders because the authoritative amount lives in the Stripe `Price` object, not locally — the webhook handler in Task 12 reads the real charged amount from `session.amount_total` and can backfill it. Flag this to the human reviewer at the next security checkpoint: confirm whether `orders.amount_cents` must always reflect the true charged amount (recommended) before Task 12 is implemented, since `charge.refunded`'s partial/total comparison in Task 12 depends on `amount_cents` being accurate for both fixed and custom orders.

---

### Task 10: Checkout controller

**Files:**
- Create: `src/checkout/checkout.controller.ts`
- Create: `src/checkout/checkout.module.ts`
- Test: `src/checkout/checkout.controller.spec.ts`

**Interfaces:**
- Consumes: `CheckoutService.createSession` (Task 9), `CreateCheckoutSessionDto` (Task 8).
- Produces: `POST /checkout/sessions` → `201 { checkoutUrl: string }`.

- [ ] **Step 1: Write the failing test**

```typescript
// src/checkout/checkout.controller.spec.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest checkout.controller.spec.ts`
Expected: FAIL — `Cannot find module './checkout.controller'`

- [ ] **Step 3: Write `src/checkout/checkout.controller.ts`**

```typescript
import { Body, Controller, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CheckoutService } from './checkout.service';
import { CreateCheckoutSessionDto } from './dto/create-checkout-session.dto';

@Controller('checkout')
export class CheckoutController {
  constructor(private readonly checkoutService: CheckoutService) {}

  @Post('sessions')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  create(@Body() dto: CreateCheckoutSessionDto): Promise<{ checkoutUrl: string }> {
    return this.checkoutService.createSession(dto);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest checkout.controller.spec.ts`
Expected: PASS (1 test)

- [ ] **Step 5: Write `src/checkout/checkout.module.ts`**

```typescript
import { Module } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module';
import { CheckoutController } from './checkout.controller';
import { CheckoutService } from './checkout.service';
import { stripeClientProvider } from './stripe.provider';

@Module({
  imports: [OrdersModule],
  controllers: [CheckoutController],
  providers: [CheckoutService, stripeClientProvider],
})
export class CheckoutModule {}
```

- [ ] **Step 6: Commit**

```bash
git add src/checkout/checkout.controller.ts src/checkout/checkout.controller.spec.ts src/checkout/checkout.module.ts
git commit -m "feat: add POST /checkout/sessions endpoint"
```

---

### Task 11 (Security Checkpoint 2): Review checkout flow

- [ ] **Step 1: Invoke the `security-review` skill** against Tasks 8-10, focused on: (a) does the DTO genuinely reject every client-supplied combination that mixes `priceId`/`amountCents` with the wrong `productType`; (b) is `currency` reachable from any client input at all (grep the diff for `currency` outside `checkout.service.ts`'s hardcoded constant); (c) is the `priceId` allowlist sourced only from server config, never echoed back or accepted from the body unchecked; (d) does `attachStripeSessionId` create any window where an order exists with an attacker-guessable placeholder `stripeSessionId` that could collide before Stripe returns the real one; (e) resolve the open note at the end of Task 9 about `amount_cents` accuracy for fixed-price orders — decide now, before Task 12 depends on it.
- [ ] **Step 2: Record the resolution of the `amount_cents` question from Task 9** in this plan file (edit this task's checkbox area with the decision) and apply any required code change before proceeding to Task 12.

---

### Task 12: Stripe webhook — signature verification + idempotent transaction skeleton

**This is the highest-risk task in the system. Do not proceed past it without the checkpoint in Task 14.**

**Files:**
- Create: `src/webhooks/stripe-webhook.service.ts`
- Create: `src/webhooks/stripe-webhook.controller.ts`
- Create: `src/webhooks/webhooks.module.ts`
- Test: `src/webhooks/stripe-webhook.service.spec.ts`
- Test: `src/webhooks/stripe-webhook.controller.spec.ts`

**Interfaces:**
- Consumes: `STRIPE_CLIENT` (Task 9), `OrdersService.transitionAtomic` (Task 6), `AuditLogService.record` (Task 5), `DataSource` (`typeorm`).
- Produces: `StripeWebhookService.handleRawEvent(rawBody: Buffer, signatureHeader: string): Promise<{ outcome: 'processed' | 'rejected' | 'duplicate' }>`.
- Produces: `StripeWebhookService.EVENT_HANDLERS: Record<string, EventHandler>` — an injectable map populated in Task 13 for the three real event types; unhandled types fall through to a default no-op handler defined here.
- Produces: `type EventHandler = (queryRunner: QueryRunner, event: Stripe.Event) => Promise<{ orderId: string | null }>`.

- [ ] **Step 1: Write the failing test for signature/idempotency behavior**

```typescript
// src/webhooks/stripe-webhook.service.spec.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest stripe-webhook.service.spec.ts`
Expected: FAIL — `Cannot find module './stripe-webhook.service'`

- [ ] **Step 3: Write `src/webhooks/stripe-webhook.service.ts`**

```typescript
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, QueryRunner } from 'typeorm';
import Stripe from 'stripe';
import { STRIPE_CLIENT } from '../checkout/stripe.provider';
import { AuditLogService } from '../audit-log/audit-log.service';

export type EventHandler = (
  queryRunner: QueryRunner,
  event: Stripe.Event,
) => Promise<{ orderId: string | null }>;

@Injectable()
export class StripeWebhookService {
  private readonly logger = new Logger(StripeWebhookService.name);
  private readonly webhookSecret: string;

  /** Populated by handler registration in Task 13; unregistered types fall through to the default no-op. */
  public readonly EVENT_HANDLERS: Record<string, EventHandler> = {};

  constructor(
    @Inject(STRIPE_CLIENT) private readonly stripe: Stripe,
    private readonly dataSource: DataSource,
    private readonly auditLog: AuditLogService,
    private readonly config: ConfigService,
  ) {
    this.webhookSecret = this.config.get<string>('STRIPE_WEBHOOK_SECRET')!;
  }

  async handleRawEvent(
    rawBody: Buffer,
    signatureHeader: string,
  ): Promise<{ outcome: 'processed' | 'rejected' | 'duplicate' }> {
    let event: Stripe.Event;
    try {
      event = this.stripe.webhooks.constructEvent(rawBody, signatureHeader, this.webhookSecret);
    } catch (err) {
      await this.auditLog.record({
        action: 'signature_invalid',
        reason: (err as Error).message,
      });
      return { outcome: 'rejected' };
    }

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const insertResult = await queryRunner.query(
        `INSERT INTO processed_stripe_events (event_id, event_type, outcome)
         VALUES ($1, $2, 'processed') ON CONFLICT (event_id) DO NOTHING`,
        [event.id, event.type],
      );
      const rowsAffected = insertResult[1] ?? 0;

      if (rowsAffected === 0) {
        await queryRunner.rollbackTransaction();
        await this.auditLog.record({ action: 'duplicate', eventId: event.id, eventType: event.type });
        return { outcome: 'duplicate' };
      }

      const handler = this.EVENT_HANDLERS[event.type];
      let orderId: string | null = null;

      if (handler) {
        const handlerResult = await handler(queryRunner, event);
        orderId = handlerResult.orderId;
      } else {
        await this.auditLog.record({ action: 'event_type_ignored', eventId: event.id, eventType: event.type });
      }

      await queryRunner.commitTransaction();
      return { outcome: 'processed' };
    } catch (err) {
      await queryRunner.rollbackTransaction();
      await this.auditLog.record({
        action: 'processing_error',
        eventId: event.id,
        eventType: event.type,
        reason: (err as Error).message,
      });
      throw err;
    } finally {
      await queryRunner.release();
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest stripe-webhook.service.spec.ts`
Expected: PASS (4 tests). If `insertResult[1]` does not carry the row count for this TypeORM/pg version, adjust the extraction the same way as flagged in Task 6 Step 4 — the tests are the source of truth.

- [ ] **Step 5: Write the failing test for the controller's raw-body handling**

```typescript
// src/webhooks/stripe-webhook.controller.spec.ts
import { Test } from '@nestjs/testing';
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
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npx jest stripe-webhook.controller.spec.ts`
Expected: FAIL — `Cannot find module './stripe-webhook.controller'`

- [ ] **Step 7: Write `src/webhooks/stripe-webhook.controller.ts`**

Uses Nest's built-in `rawBody` support (enabled via `NestFactory.create(AppModule, { rawBody: true })` in Task 1's `main.ts`), which populates `req.rawBody` for every request while still letting the global JSON body parser run for every other route — no manual bypass of the global parser is needed.

```typescript
import { Controller, Headers, HttpCode, Post, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { StripeWebhookService } from './stripe-webhook.service';

@Controller('webhooks')
export class StripeWebhookController {
  constructor(private readonly webhookService: StripeWebhookService) {}

  @Post('stripe')
  @HttpCode(200)
  @Throttle({ default: { limit: 100, ttl: 60_000 } })
  async handle(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature: string,
  ): Promise<{ received: true }> {
    await this.webhookService.handleRawEvent(req.rawBody!, signature);
    return { received: true };
  }
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npx jest stripe-webhook.controller.spec.ts`
Expected: PASS (1 test)

- [ ] **Step 9: Write `src/webhooks/webhooks.module.ts`**

```typescript
import { Module } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { StripeWebhookController } from './stripe-webhook.controller';
import { StripeWebhookService } from './stripe-webhook.service';
import { stripeClientProvider } from '../checkout/stripe.provider';

@Module({
  imports: [OrdersModule, AuditLogModule],
  controllers: [StripeWebhookController],
  providers: [StripeWebhookService, stripeClientProvider],
})
export class WebhooksModule {}
```

- [ ] **Step 10: Commit**

```bash
git add src/webhooks
git commit -m "feat: add Stripe webhook signature verification and idempotent transaction skeleton"
```

---

### Task 13: Webhook event handlers (checkout-completed, payment-failed, charge-refunded)

**Files:**
- Create: `src/webhooks/handlers/checkout-completed.handler.ts`
- Create: `src/webhooks/handlers/payment-failed.handler.ts`
- Create: `src/webhooks/handlers/charge-refunded.handler.ts`
- Test: `src/webhooks/handlers/webhook-handlers.spec.ts` (integration test against the real local Postgres)
- Modify: `src/webhooks/stripe-webhook.service.ts` (register the three handlers in `EVENT_HANDLERS`)
- Modify: `src/webhooks/webhooks.module.ts` (wire handler registration + `EmailOutboxEntity` repository access if inserting directly, or via `OutboxModule` — see Task 15)
- Modify: `src/orders/orders.service.ts` (no change expected; handlers call `transitionAtomic` directly with a `QueryRunner`)

**Interfaces:**
- Consumes: `EventHandler` type and `EVENT_HANDLERS` map (Task 12), `OrdersService.transitionAtomic` semantics reimplemented via raw `queryRunner.query` (handlers run inside the webhook's `QueryRunner`, not through `OrdersService`, because `OrdersService`'s repository is bound to the default connection, not the webhook's transaction — handlers use `queryRunner.query` directly with the same SQL shape as `transitionAtomic`).
- Produces: `checkoutCompletedHandler: EventHandler`, `paymentFailedHandler: EventHandler`, `chargeRefundedHandler: EventHandler`.

- [ ] **Step 1: Write the failing integration test**

```typescript
// src/webhooks/handlers/webhook-handlers.spec.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest webhook-handlers.spec.ts`
Expected: FAIL — cannot find handler modules

- [ ] **Step 3: Write `src/webhooks/handlers/checkout-completed.handler.ts`**

```typescript
import { QueryRunner } from 'typeorm';
import Stripe from 'stripe';
import { EventHandler } from '../stripe-webhook.service';

export const checkoutCompletedHandler: EventHandler = async (queryRunner: QueryRunner, event: Stripe.Event) => {
  const session = event.data.object as Stripe.Checkout.Session;
  const donorEmail = session.customer_details?.email ?? null;
  const paymentIntentId =
    typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id ?? null;
  const chargedAmountCents = session.amount_total ?? 0;

  const [orderRow] = await queryRunner.query(`SELECT id FROM orders WHERE stripe_session_id = $1`, [session.id]);
  if (!orderRow) {
    return { orderId: null };
  }

  await queryRunner.query(
    `UPDATE orders
     SET status = 'paid', donor_email = $2, stripe_payment_intent_id = $3, amount_cents = $4, updated_at = now()
     WHERE id = $1 AND status = 'pending'`,
    [orderRow.id, donorEmail, paymentIntentId, chargedAmountCents],
  );

  await queryRunner.query(
    `INSERT INTO email_outbox (order_id, status) VALUES ($1, 'pending')`,
    [orderRow.id],
  );

  return { orderId: orderRow.id as string };
};
```

**Checkpoint 2 ruling (see security checkpoint below, resolved here rather than left open):** `amount_cents` is now always overwritten from Stripe's authoritative `session.amount_total` at the moment an order transitions to `paid`, for BOTH `fixed` and `custom` orders — not just backfilled for the `fixed` case. This closes the gap where a `fixed`-price order's `amount_cents=0` placeholder (set at checkout-session-creation time, per Task 9) would have made `chargeRefundedHandler`'s `isFullRefund = charge.amount_refunded >= orders.amount_cents` comparison trivially true for ANY refund amount (since any amount >= 0), misclassifying a partial refund as a full refund and incorrectly transitioning the order to `refunded`. By the time a refund can occur, the order is already `paid` with the real charged amount recorded, so the comparison in `chargeRefundedHandler` is now accurate for all orders regardless of pricing mode.

- [ ] **Step 4: Write `src/webhooks/handlers/payment-failed.handler.ts`**

```typescript
import { QueryRunner } from 'typeorm';
import Stripe from 'stripe';
import { EventHandler } from '../stripe-webhook.service';

export const paymentFailedHandler: EventHandler = async (queryRunner: QueryRunner, event: Stripe.Event) => {
  const object = event.data.object as { id: string };

  const [orderRow] = await queryRunner.query(`SELECT id FROM orders WHERE stripe_session_id = $1`, [object.id]);
  if (!orderRow) {
    return { orderId: null };
  }

  await queryRunner.query(
    `UPDATE orders SET status = 'failed', updated_at = now() WHERE id = $1 AND status = 'pending'`,
    [orderRow.id],
  );

  return { orderId: orderRow.id as string };
};
```

- [ ] **Step 5: Write `src/webhooks/handlers/charge-refunded.handler.ts`**

```typescript
import { QueryRunner } from 'typeorm';
import Stripe from 'stripe';
import { EventHandler } from '../stripe-webhook.service';

export const chargeRefundedHandler: EventHandler = async (queryRunner: QueryRunner, event: Stripe.Event) => {
  const charge = event.data.object as Stripe.Charge;
  const paymentIntentId =
    typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id;

  const [orderRow] = await queryRunner.query(
    `SELECT id, amount_cents FROM orders WHERE stripe_payment_intent_id = $1`,
    [paymentIntentId],
  );
  if (!orderRow) {
    return { orderId: null };
  }

  const isFullRefund = charge.amount_refunded >= orderRow.amount_cents;

  if (isFullRefund) {
    await queryRunner.query(
      `UPDATE orders
       SET status = 'refunded', refunded_amount_cents = $2, updated_at = now()
       WHERE id = $1 AND status = 'paid'`,
      [orderRow.id, charge.amount_refunded],
    );
  } else {
    await queryRunner.query(
      `UPDATE orders SET refunded_amount_cents = $2, updated_at = now() WHERE id = $1`,
      [orderRow.id, charge.amount_refunded],
    );
  }

  return { orderId: orderRow.id as string };
};
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx jest webhook-handlers.spec.ts`
Expected: PASS (4 tests)

- [ ] **Step 7: Register the handlers in `StripeWebhookService` — modify `src/webhooks/webhooks.module.ts`**

```typescript
import { Module, OnModuleInit } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { StripeWebhookController } from './stripe-webhook.controller';
import { StripeWebhookService } from './stripe-webhook.service';
import { stripeClientProvider } from '../checkout/stripe.provider';
import { checkoutCompletedHandler } from './handlers/checkout-completed.handler';
import { paymentFailedHandler } from './handlers/payment-failed.handler';
import { chargeRefundedHandler } from './handlers/charge-refunded.handler';

@Module({
  imports: [OrdersModule, AuditLogModule],
  controllers: [StripeWebhookController],
  providers: [StripeWebhookService, stripeClientProvider],
})
export class WebhooksModule implements OnModuleInit {
  constructor(private readonly webhookService: StripeWebhookService) {}

  onModuleInit() {
    this.webhookService.EVENT_HANDLERS['checkout.session.completed'] = checkoutCompletedHandler;
    this.webhookService.EVENT_HANDLERS['checkout.session.expired'] = paymentFailedHandler;
    this.webhookService.EVENT_HANDLERS['payment_intent.payment_failed'] = paymentFailedHandler;
    this.webhookService.EVENT_HANDLERS['charge.refunded'] = chargeRefundedHandler;
  }
}
```

- [ ] **Step 8: (superseded)** `stripe_payment_intent_id` and `amount_cents` are already persisted by `checkoutCompletedHandler` in Step 3 above (both were added there directly per the Checkpoint 2 ruling) — no separate step needed. Just re-run `npx jest webhook-handlers.spec.ts` to confirm the Step 1 test (updated below to assert `amount_cents`) passes.

- [ ] **Step 9: Commit**

```bash
git add src/webhooks
git commit -m "feat: add checkout-completed, payment-failed, charge-refunded webhook handlers"
```

---

### Task 14 (Security Checkpoint 3 — Critical): Review webhook signature, idempotency, and state-transition path end-to-end

**This is the checkpoint the whole design was built around. Do not skip or abbreviate it.**

- [ ] **Step 1: Invoke the `security-review` skill** against Tasks 12-13 together, with explicit focus on each threat from the spec's STRIDE table:
  - **Tampering (T2):** confirm the raw body reaching `constructEvent` is byte-identical to what Stripe sent — no JSON re-serialization anywhere in the path from `main.ts`'s `rawBody: true` through `StripeWebhookController`.
  - **Replay (RP1/RP2):** confirm `constructEvent`'s default tolerance is in effect (no `tolerance: 0` or disabled check), and that the idempotency `INSERT ... ON CONFLICT DO NOTHING` genuinely runs before any handler executes.
  - **Elevation of Privilege (E1/E2):** confirm every handler's `UPDATE` carries a `WHERE status = '<expected-origin>'` clause with no code path that writes `status` without that guard, and that `checkout-completed`/`payment-failed` key off `stripe_session_id` while `charge-refunded` keys off `stripe_payment_intent_id` — never off a client-suppliable id.
  - **Transaction integrity:** confirm the rollback test in Task 12 Step 1 (the "handler throws" case) actually proves the idempotency `INSERT` is undone — trace that `processed_stripe_events` has zero rows after a forced handler failure in a real (non-mocked) run, not just via the mocked unit test.
  - **Rate limiting:** confirm `@Throttle` is present on `POST /webhooks/stripe` and that the signature check happens before any DB query (fail-fast ordering, mitigating D2).
- [ ] **Step 2: Run one real end-to-end pass with the Stripe CLI** before considering this checkpoint closed:
  - Run: `stripe listen --forward-to localhost:3000/webhooks/stripe` (note the `whsec_...` it prints and set it as `STRIPE_WEBHOOK_SECRET` in `.env` for this run)
  - Run: `npm run start:dev`
  - Run: `stripe trigger checkout.session.completed` — confirm in the DB that `orders.status` became `paid`, `processed_stripe_events` has one row for that `event_id`, and `audit_log` recorded the transition.
  - Re-run the exact same `stripe trigger checkout.session.completed` command (or use `stripe events resend <id>`) — confirm the second delivery is logged as `duplicate` and the order is unaffected.
- [ ] **Step 3: Record the outcome** ("Checkpoint 3: passed" plus any findings and fixes applied) before starting Task 15.

---

### Task 15: Email outbox — entity wiring, mail provider, and cron processor

**Files:**
- Create: `src/outbox/mail.provider.ts`
- Create: `src/outbox/email-outbox.service.ts`
- Create: `src/outbox/email-outbox.processor.ts`
- Create: `src/outbox/outbox.module.ts`
- Test: `src/outbox/email-outbox.service.spec.ts`
- Modify: `src/webhooks/webhooks.module.ts` (import `OutboxModule` if `checkout-completed.handler.ts`'s outbox insert is moved behind a service — kept as direct SQL per Task 13 for transactional consistency, so no change needed here)
- Modify: `src/app.module.ts` (import `ScheduleModule.forRoot()` and `OutboxModule`)

**Interfaces:**
- Produces: `MAIL_TRANSPORT` injection token (a `nodemailer.Transporter`).
- Produces: `EmailOutboxService.processPendingBatch(): Promise<{ sent: number; failed: number }>` — selects up to 20 `pending` rows with `attempts < OUTBOX_MAX_ATTEMPTS` using `FOR UPDATE SKIP LOCKED`, attempts to send each, updates outcome.
- Produces: `EmailOutboxProcessor` — a `@Cron` provider that calls `processPendingBatch()` every 10 seconds.

- [ ] **Step 1: Write `src/outbox/mail.provider.ts`**

```typescript
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

export const MAIL_TRANSPORT = 'MAIL_TRANSPORT';

export const mailTransportProvider = {
  provide: MAIL_TRANSPORT,
  inject: [ConfigService],
  useFactory: (config: ConfigService) =>
    nodemailer.createTransport({
      host: config.get<string>('SMTP_HOST'),
      port: config.get<number>('SMTP_PORT'),
      auth: config.get<string>('SMTP_USER')
        ? { user: config.get<string>('SMTP_USER'), pass: config.get<string>('SMTP_PASS') }
        : undefined,
    }),
};
```

- [ ] **Step 2: Write the failing test for `EmailOutboxService`**

```typescript
// src/outbox/email-outbox.service.spec.ts
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { EmailOutboxService } from './email-outbox.service';
import { MAIL_TRANSPORT } from './mail.provider';

describe('EmailOutboxService', () => {
  let service: EmailOutboxService;
  let dataSource: { query: jest.Mock };
  let mailTransport: { sendMail: jest.Mock };

  beforeEach(async () => {
    dataSource = { query: jest.fn() };
    mailTransport = { sendMail: jest.fn() };
    const config = { get: jest.fn().mockReturnValue('5') };

    const module = await Test.createTestingModule({
      providers: [
        EmailOutboxService,
        { provide: DataSource, useValue: dataSource },
        { provide: MAIL_TRANSPORT, useValue: mailTransport },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();
    service = module.get(EmailOutboxService);
  });

  it('sends each pending row and marks it sent', async () => {
    dataSource.query
      .mockResolvedValueOnce([{ id: '1', order_id: 'o1', attempts: 0 }]) // SELECT ... FOR UPDATE SKIP LOCKED
      .mockResolvedValueOnce([[], 1]); // UPDATE ... SET status='sent'
    mailTransport.sendMail.mockResolvedValue(undefined);

    const result = await service.processPendingBatch();

    expect(mailTransport.sendMail).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ sent: 1, failed: 0 });
  });

  it('increments attempts and records last_error on send failure, without throwing', async () => {
    dataSource.query
      .mockResolvedValueOnce([{ id: '2', order_id: 'o2', attempts: 4 }])
      .mockResolvedValueOnce([[], 1]); // UPDATE ... SET attempts=attempts+1, status='failed' (attempts now >= max)
    mailTransport.sendMail.mockRejectedValue(new Error('smtp down'));

    const result = await service.processPendingBatch();

    expect(result).toEqual({ sent: 0, failed: 1 });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx jest email-outbox.service.spec.ts`
Expected: FAIL — `Cannot find module './email-outbox.service'`

- [ ] **Step 4: Write `src/outbox/email-outbox.service.ts`**

```typescript
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { MAIL_TRANSPORT } from './mail.provider';
import type { Transporter } from 'nodemailer';

interface PendingRow {
  id: string;
  order_id: string;
  attempts: number;
}

@Injectable()
export class EmailOutboxService {
  private readonly logger = new Logger(EmailOutboxService.name);
  private readonly maxAttempts: number;

  constructor(
    private readonly dataSource: DataSource,
    @Inject(MAIL_TRANSPORT) private readonly mailTransport: Transporter,
    private readonly config: ConfigService,
  ) {
    this.maxAttempts = Number(this.config.get<string>('OUTBOX_MAX_ATTEMPTS'));
  }

  async processPendingBatch(): Promise<{ sent: number; failed: number }> {
    const rows: PendingRow[] = await this.dataSource.query(
      `SELECT id, order_id, attempts FROM email_outbox
       WHERE status = 'pending' AND attempts < $1
       ORDER BY created_at ASC
       FOR UPDATE SKIP LOCKED
       LIMIT 20`,
      [this.maxAttempts],
    );

    let sent = 0;
    let failed = 0;

    for (const row of rows) {
      try {
        const [orderRow] = await this.dataSource.query(
          `SELECT donor_email FROM orders WHERE id = $1`,
          [row.order_id],
        );
        await this.mailTransport.sendMail({
          to: orderRow?.donor_email,
          from: this.config.get<string>('SMTP_FROM'),
          subject: 'Confirmação de doação',
          text: 'Obrigado pela sua doação! Seu pagamento foi confirmado.',
        });
        await this.dataSource.query(
          `UPDATE email_outbox SET status = 'sent', sent_at = now() WHERE id = $1`,
          [row.id],
        );
        sent += 1;
      } catch (err) {
        const nextAttempts = row.attempts + 1;
        const nextStatus = nextAttempts >= this.maxAttempts ? 'failed' : 'pending';
        await this.dataSource.query(
          `UPDATE email_outbox SET attempts = $2, status = $3, last_error = $4 WHERE id = $1`,
          [row.id, nextAttempts, nextStatus, (err as Error).message],
        );
        this.logger.warn(`email_outbox send failed for row ${row.id}: ${(err as Error).message}`);
        failed += 1;
      }
    }

    return { sent, failed };
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx jest email-outbox.service.spec.ts`
Expected: PASS (2 tests)

- [ ] **Step 6: Write `src/outbox/email-outbox.processor.ts`**

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { EmailOutboxService } from './email-outbox.service';

@Injectable()
export class EmailOutboxProcessor {
  private readonly logger = new Logger(EmailOutboxProcessor.name);

  constructor(private readonly outboxService: EmailOutboxService) {}

  @Cron(CronExpression.EVERY_10_SECONDS)
  async handleCron() {
    const result = await this.outboxService.processPendingBatch();
    if (result.sent > 0 || result.failed > 0) {
      this.logger.log(`email outbox batch: sent=${result.sent} failed=${result.failed}`);
    }
  }
}
```

- [ ] **Step 7: Write `src/outbox/outbox.module.ts`**

```typescript
import { Module } from '@nestjs/common';
import { EmailOutboxService } from './email-outbox.service';
import { EmailOutboxProcessor } from './email-outbox.processor';
import { mailTransportProvider } from './mail.provider';

@Module({
  providers: [EmailOutboxService, EmailOutboxProcessor, mailTransportProvider],
})
export class OutboxModule {}
```

- [ ] **Step 8: Import `ScheduleModule` and `OutboxModule` in `src/app.module.ts`**

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { envValidationSchema } from './common/config/env.validation';
import { buildDataSourceOptions } from './database/data-source';
import { OrdersModule } from './orders/orders.module';
import { CheckoutModule } from './checkout/checkout.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { OutboxModule } from './outbox/outbox.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validationSchema: envValidationSchema }),
    ScheduleModule.forRoot(),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => buildDataSourceOptions(config.get<string>('DATABASE_URL')!),
    }),
    OrdersModule,
    CheckoutModule,
    WebhooksModule,
    OutboxModule,
  ],
})
export class AppModule {}
```

- [ ] **Step 9: Commit**

```bash
git add src/outbox src/app.module.ts
git commit -m "feat: add email outbox with FOR UPDATE SKIP LOCKED cron processor"
```

---

### Task 16 (Security Checkpoint 4): Review outbox isolation from payment state

- [ ] **Step 1: Invoke the `security-review` skill** focused on: does any path in `EmailOutboxService` or `EmailOutboxProcessor` write to `orders.status`? (It must not — email is purely notification.) Does `FOR UPDATE SKIP LOCKED` actually run inside an implicit transaction (a bare `dataSource.query` for a `SELECT ... FOR UPDATE` outside a transaction is a no-op lock in Postgres) — if so, wrap `processPendingBatch` in an explicit transaction via `dataSource.transaction(...)` or a `QueryRunner`, and add a test proving two concurrent calls to `processPendingBatch` never send the same row twice.
- [ ] **Step 2: Apply any fix identified** (most likely: wrapping the SELECT+loop in a transaction) and re-run `npx jest email-outbox.service.spec.ts` to confirm still green. Record the outcome.

---

### Task 17: Global security hardening (Helmet, CORS, ValidationPipe, exception filter, static frontend)

**Files:**
- Create: `src/common/filters/http-exception.filter.ts`
- Test: `src/common/filters/http-exception.filter.spec.ts`
- Modify: `src/main.ts`
- Modify: `src/app.module.ts` (add `ThrottlerModule.forRoot`, `ServeStaticModule.forRoot`)

**Interfaces:**
- Produces: `AllExceptionsFilter` (implements `ExceptionFilter`) — maps any thrown error to `{ statusCode, message }` with no stack trace and no internal detail for non-`HttpException` errors (mapped to generic `500 Internal Server Error`).

- [ ] **Step 1: Write the failing test**

```typescript
// src/common/filters/http-exception.filter.spec.ts
import { ArgumentsHost, BadRequestException } from '@nestjs/common';
import { AllExceptionsFilter } from './http-exception.filter';

function buildHost(jsonMock: jest.Mock) {
  const response = { status: jest.fn().mockReturnThis(), json: jsonMock };
  return {
    switchToHttp: () => ({ getResponse: () => response, getRequest: () => ({}) }),
  } as unknown as ArgumentsHost;
}

describe('AllExceptionsFilter', () => {
  it('passes through statusCode and message for a known HttpException', () => {
    const filter = new AllExceptionsFilter();
    const json = jest.fn();
    filter.catch(new BadRequestException('amountCents must be between 500 and 100000'), buildHost(json));
    expect(json).toHaveBeenCalledWith({
      statusCode: 400,
      message: 'amountCents must be between 500 and 100000',
    });
  });

  it('never leaks internal error details for an unexpected error', () => {
    const filter = new AllExceptionsFilter();
    const json = jest.fn();
    filter.catch(new Error('connection string password=hunter2 invalid'), buildHost(json));
    const payload = json.mock.calls[0][0];
    expect(payload).toEqual({ statusCode: 500, message: 'Internal server error' });
    expect(JSON.stringify(payload)).not.toContain('hunter2');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest http-exception.filter.spec.ts`
Expected: FAIL — `Cannot find module './http-exception.filter'`

- [ ] **Step 3: Write `src/common/filters/http-exception.filter.ts`**

```typescript
import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Response } from 'express';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const message = typeof body === 'string' ? body : (body as { message?: string }).message ?? exception.message;
      response.status(status).json({ statusCode: status, message });
      return;
    }

    this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Internal server error',
    });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest http-exception.filter.spec.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Rewrite `src/main.ts` with full hardening**

```typescript
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/http-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });

  app.use(helmet());
  app.enableCors({
    origin: process.env.FRONTEND_ORIGIN,
    methods: ['GET', 'POST'],
    credentials: false,
  });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
```

- [ ] **Step 6: Add `ThrottlerModule` and `ServeStaticModule` to `src/app.module.ts`**

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { ServeStaticModule } from '@nestjs/serve-static';
import { APP_GUARD } from '@nestjs/core';
import { join } from 'path';
import { envValidationSchema } from './common/config/env.validation';
import { buildDataSourceOptions } from './database/data-source';
import { OrdersModule } from './orders/orders.module';
import { CheckoutModule } from './checkout/checkout.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { OutboxModule } from './outbox/outbox.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validationSchema: envValidationSchema }),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 20 }]),
    ServeStaticModule.forRoot({ rootPath: join(__dirname, '..', 'public') }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => buildDataSourceOptions(config.get<string>('DATABASE_URL')!),
    }),
    OrdersModule,
    CheckoutModule,
    WebhooksModule,
    OutboxModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
```

- [ ] **Step 7: Run the full test suite to confirm no regressions**

Run: `npx jest`
Expected: PASS (all suites)

- [ ] **Step 8: Commit**

```bash
git add src/common/filters src/main.ts src/app.module.ts
git commit -m "feat: add global helmet, CORS, ValidationPipe, exception filter, throttling, and static hosting"
```

---

### Task 18 (Security Checkpoint 5): Review global hardening end-to-end

- [ ] **Step 1: Invoke the `security-review` skill** against Task 17, focused on: (a) does `ValidationPipe`'s `forbidNonWhitelisted` actually reject an extra field on `POST /checkout/sessions` (verify with a manual `curl`/`Invoke-WebRequest` call sending an unexpected field, expect `400`); (b) does the exception filter's `500` branch ever leak a stack trace in the JSON response under any code path (grep for any other `response.json` call in the codebase that might bypass the filter); (c) does `helmet()`'s default CSP interfere with the static frontend's inline `<script>`/`<style>` usage — if `index.html`/`success.html` use inline scripts, either move them to external `.js`/`.css` files (preferred, matches the file structure already planned) or configure a CSP directive explicitly, never disable CSP outright; (d) confirm `STRIPE_ALLOWED_PRICE_IDS`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, DB and SMTP credentials never appear in any `console.log`/`Logger` call across the codebase (grep for `.log(` near `config.get`).
- [ ] **Step 2: Apply fixes and record the outcome** before starting the frontend task.

---

### Task 19: Static frontend (index, success, cancel pages)

**Files:**
- Create: `public/index.html`
- Create: `public/success.html`
- Create: `public/cancel.html`
- Create: `public/style.css`
- Create: `public/checkout.js`
- Create: `public/status-poll.js`

No automated tests for static HTML/CSS/JS in this stack — verified manually in Step 5 below against the running server, per the spec's "no build step" decision.

- [ ] **Step 1: Write `public/checkout.js`**

```javascript
async function startCheckout(body) {
  const response = await fetch('/checkout/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Erro ao iniciar doação.' }));
    alert(error.message || 'Erro ao iniciar doação.');
    return;
  }
  const { checkoutUrl } = await response.json();
  window.location.href = checkoutUrl;
}

function onFixedDonationClick(priceId) {
  startCheckout({ productType: 'fixed', priceId });
}

function onCustomDonationSubmit(event) {
  event.preventDefault();
  const input = document.getElementById('custom-amount');
  const amountReais = parseFloat(input.value);
  if (Number.isNaN(amountReais) || amountReais <= 0) {
    alert('Informe um valor válido.');
    return;
  }
  const amountCents = Math.round(amountReais * 100);
  startCheckout({ productType: 'custom', amountCents });
}

document.addEventListener('DOMContentLoaded', () => {
  const fixedButton = document.getElementById('fixed-donation-button');
  if (fixedButton) {
    fixedButton.addEventListener('click', () => onFixedDonationClick('price_allowed_1'));
  }
  const customForm = document.getElementById('custom-form');
  if (customForm) {
    customForm.addEventListener('submit', onCustomDonationSubmit);
  }
});
```

**Checkpoint 5 note (resolved here rather than left for Task 19 to discover the hard way):** helmet's default CSP (`script-src 'self'`, no `'unsafe-inline'`) blocks BOTH inline `<script>` blocks AND inline event-handler attributes (`onclick="..."`). The event-binding logic above moved from an inline `<script>` tag and an `onclick` attribute (both CSP violations under `main.ts`'s unmodified `helmet()` config from Task 17) into `checkout.js` itself via `addEventListener` on `DOMContentLoaded`, matching the already-CSP-safe pattern `status-poll.js` (Step 2 below) already uses. `index.html` (Step 3) no longer has an inline `<script>` block or an `onclick` attribute — see the updated markup below.

- [ ] **Step 2: Write `public/status-poll.js`**

```javascript
const MAX_ATTEMPTS = 30;
const POLL_INTERVAL_MS = 2000;

async function pollOrderStatus(orderId) {
  const statusEl = document.getElementById('status-message');
  let attempts = 0;

  while (attempts < MAX_ATTEMPTS) {
    try {
      const response = await fetch(`/orders/${orderId}/status`);
      if (response.ok) {
        const { status } = await response.json();
        if (status === 'paid') {
          statusEl.textContent = 'Doação confirmada! Obrigado.';
          return;
        }
        if (status === 'failed') {
          statusEl.textContent = 'O pagamento não foi concluído.';
          return;
        }
      }
    } catch {
      // network hiccup: keep polling, never surface as a hard error
    }
    attempts += 1;
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  statusEl.textContent = 'Ainda processando — você receberá a confirmação por e-mail em breve.';
}

document.addEventListener('DOMContentLoaded', () => {
  const params = new URLSearchParams(window.location.search);
  const orderId = params.get('order');
  if (orderId) {
    pollOrderStatus(orderId);
  }
});
```

- [ ] **Step 3: Write `public/index.html`**

```html
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Catraca Financeira</title>
  <link rel="stylesheet" href="/style.css" />
</head>
<body>
  <main>
    <h1>Apoie este projeto</h1>
    <section>
      <button id="fixed-donation-button">Doar valor fixo</button>
    </section>
    <section>
      <form id="custom-form">
        <label for="custom-amount">Outro valor (R$)</label>
        <input type="number" id="custom-amount" min="5" step="0.01" required />
        <button type="submit">Doar</button>
      </form>
    </section>
  </main>
  <script src="/checkout.js"></script>
</body>
</html>
```

- [ ] **Step 4: Write `public/success.html` and `public/cancel.html`**

```html
<!-- public/success.html -->
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta name="referrer" content="no-referrer" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Doação em processamento</title>
  <link rel="stylesheet" href="/style.css" />
</head>
<body>
  <main>
    <h1>Obrigado!</h1>
    <p id="status-message">Confirmando seu pagamento...</p>
  </main>
  <script src="/status-poll.js"></script>
</body>
</html>
```

```html
<!-- public/cancel.html -->
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Doação cancelada</title>
  <link rel="stylesheet" href="/style.css" />
</head>
<body>
  <main>
    <h1>Doação cancelada</h1>
    <p><a href="/index.html">Voltar</a></p>
  </main>
</body>
</html>
```

- [ ] **Step 5: Write `public/style.css`**

```css
body { font-family: system-ui, sans-serif; max-width: 480px; margin: 3rem auto; padding: 0 1rem; }
h1 { font-size: 1.5rem; }
button { padding: 0.5rem 1rem; margin-top: 0.5rem; cursor: pointer; }
input { padding: 0.4rem; }
```

- [ ] **Step 6: Manually verify in a browser**

Run: `npm run start:dev`
Open `http://localhost:3000/index.html`, click the fixed-donation button, confirm it redirects to a Stripe Checkout test page (use Stripe test card `4242 4242 4242 4242`), confirm redirect back to `success.html?order=<uuid>` and that the status message updates to "Doação confirmada!" once the webhook (via `stripe listen`) processes the event.

- [ ] **Step 7: Commit**

```bash
git add public
git commit -m "feat: add static vanilla frontend (index, success, cancel)"
```

---

### Task 20: End-to-end verification pass with Stripe CLI (full flow, all outcomes)

**No new files — this is a manual verification task confirming the whole system together.**

- [ ] **Step 1:** Run `docker compose up -d`, `npm run typeorm:run`, `stripe listen --forward-to localhost:3000/webhooks/stripe` (copy its `whsec_...` into `.env`), `npm run start:dev`.
- [ ] **Step 2: Happy path.** Complete a fixed-price donation via the browser using Stripe's test card. Confirm: order reaches `paid`, `donor_email` populated, an `email_outbox` row moves to `sent` within ~10s (check a local mail catcher like MailHog if `SMTP_HOST` points to one, or inspect `email_outbox.status` directly), `audit_log` has entries for the event.
- [ ] **Step 3: Custom amount path.** Repeat with a custom donation amount; confirm the same outcomes and that the amount recorded in `orders.amount_cents` matches what was charged.
- [ ] **Step 4: Failure path.** Run `stripe trigger checkout.session.expired` (or abandon a checkout session and let it expire) targeting a `pending` order; confirm it transitions to `failed`.
- [ ] **Step 5: Refund path.** Run `stripe trigger charge.refunded` against a `paid` order's charge; confirm full refund transitions to `refunded` and partial refund (trigger with a custom amount via the Stripe CLI `--add` override if supported, or issue a partial refund from the Stripe Dashboard test mode) keeps `paid` while updating `refunded_amount_cents`.
- [ ] **Step 6: Replay/duplicate path.** Use `stripe events resend <event_id>` on an already-processed event; confirm `processed_stripe_events`/`audit_log` show `duplicate` and no state change occurs.
- [ ] **Step 7: Tampered signature path.** Send a raw `curl`/`Invoke-WebRequest` POST to `/webhooks/stripe` with a fabricated body and an invalid `Stripe-Signature` header; confirm `400` and an `audit_log` entry with `action='signature_invalid'`, and that no `processed_stripe_events` row was created.
- [ ] **Step 8: Record results.** Note any discrepancy from expected behavior found during this pass as a follow-up fix task before considering the MVP complete.

---

## Self-Review Notes

- **Spec coverage:** every spec section (data model, state machine, checkout API, webhook processing, outbox, security transversal controls, module structure, frontend, testing strategy) maps to at least one task above (Tasks 2-3, 6-7, 8-10, 12-14, 15-16, 17-18, 19, 20 respectively).
- **Open decision surfaced, not hidden:** Task 9's note about `amount_cents` for fixed-price orders is deliberately left as an explicit decision point at Checkpoint 2 (Task 11) rather than silently resolved, since it affects the refund-comparison logic in Task 13.
- **Type/name consistency checked:** `OrderStatus`, `EventHandler`, `AuditLogEntry`, `transitionAtomic`'s signature, and the `STRIPE_CLIENT`/`MAIL_TRANSPORT` tokens are defined once (Tasks 2, 5, 6, 9, 12, 15) and reused with identical names/shapes in every later task that consumes them.
- **Security checkpoints placed at every critical juncture the user requested:** after the state machine (Task 4), after the checkout input-trust boundary (Task 11), after the webhook signature/idempotency/transaction core (Task 14 — the deepest one), after the outbox's isolation from payment state (Task 16), and after global hardening (Task 18).
