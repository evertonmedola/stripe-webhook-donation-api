# Catraca Financeira

A donation API built to test a serious Stripe integration in practice: verified webhook signatures, real idempotency, and a state machine that only accepts transitions that make sense. It's a portfolio project. The donation is fictional, but the payment runs through Stripe for real, in test mode.

The frontend is vanilla on purpose, because the point here is the payment backend. It still has its own identity: the donation amount shows up as a mechanical counter, like an odometer, not a number inside a card.

## How it works

The visitor picks a fixed amount (R$ 20.00) or types a custom one, between R$ 5.00 and R$ 1,000,000.00. The backend creates the order as `pending`, opens a Checkout Session on Stripe, and redirects. Stripe reports the result via webhook, and from there the order can only follow one of these paths:

```
pending ──► paid ──► refunded
   └──────► failed
```

Every transition is an atomic `UPDATE ... WHERE id = $1 AND status = $2`. There's no read-then-write anywhere in the payment flow. If two events arrive at the same time, only one wins. The other becomes a silent, audited no-op, never an error.

## What the webhook handles

- `checkout.session.completed` and `payment_intent.succeeded` drive the same transition, `pending → paid`. Stripe doesn't guarantee delivery order between the two, so both handlers race for the same row: whichever arrives first wins, the other is ignored.
- `checkout.session.expired` and `payment_intent.payment_failed` move the order to `failed`.
- `charge.refunded` covers both a full refund (`paid → refunded`) and a partial one (the order stays `paid`, only the refunded amount is updated, and never overwritten by a smaller value if events arrive out of order).

Every event goes through signature verification before anything else, using the request's raw body. The webhook route sits outside the global JSON parser, because the signature only matches against the exact bytes Stripe sent. An invalid signature returns 400 and writes an audit record; nothing is persisted. Idempotency comes from a `UNIQUE` constraint on Stripe's `event_id`: a resent event is caught before any business logic runs.

## Security

- No card data ever touches the backend — that's Stripe's job.
- The audit log (`audit_log`) is append-only, written in a transaction separate from the main one, with a positive allowlist of fields. Never a spread of the raw Stripe event.
- Secrets (the Stripe key, the webhook secret, database credentials) never show up in a log, at any level.
- The app refuses to boot if a required environment variable is missing, validated via Joi before anything else runs.
- Global `ValidationPipe` with `whitelist` and `forbidNonWhitelisted`: an extra field in a request body gets rejected, not ignored.
- Rate limiting on every public endpoint.
- Currency is always fixed server-side (BRL). The client never chooses.

## Stack

NestJS 10 + TypeScript, PostgreSQL via TypeORM, the official Stripe SDK, `class-validator`, Joi for environment validation, Jest for tests. The frontend is plain HTML/CSS/JS, no framework, no build step.

## Running locally

Prerequisites: Node 20+, Docker.

```bash
npm install
cp .env.example .env   # fill in your Stripe test keys
docker compose up -d   # Postgres + Mailpit (local email capture)
npm run typeorm:run    # apply the migration
npm run start:dev
```

The server starts on `http://localhost:3000` (or whatever port you set in `PORT`).

To test the webhook flow locally, with the [Stripe CLI](https://stripe.com/docs/stripe-cli) installed:

```bash
stripe listen --forward-to localhost:3000/webhooks/stripe
```

Paste the `whsec_...` it prints into `STRIPE_WEBHOOK_SECRET`, in `.env`.

### Environment variables

| Variable | Description |
|---|---|
| `PORT` | HTTP port (defaults to 3000) |
| `DATABASE_URL` | Postgres connection string |
| `TEST_DATABASE_URL` | Separate database for the integration tests. Never point it at the same database as `DATABASE_URL`: the tests run `DELETE FROM orders` |
| `STRIPE_SECRET_KEY` | Stripe secret key (test mode) |
| `STRIPE_WEBHOOK_SECRET` | Webhook signing secret |
| `STRIPE_ALLOWED_PRICE_IDS` | Price IDs accepted for the fixed-amount donation, comma-separated |
| `MIN_DONATION_CENTS` / `MAX_DONATION_CENTS` | Bounds for the custom amount, in cents |
| `FRONTEND_ORIGIN` | Allowed CORS origin, also used in the Checkout return URLs |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` | Confirmation email delivery |
| `OUTBOX_MAX_ATTEMPTS` | Attempts before an email is marked failed |

## Endpoints

| Method | Route | What it does |
|---|---|---|
| `POST` | `/checkout/sessions` | Creates the order and the Checkout Session, returns the redirect URL |
| `GET` | `/orders/:id/status` | Looks up an order's status by UUID — just the status, nothing else |
| `POST` | `/webhooks/stripe` | Receives Stripe events |

## Structure

```
src/
  orders/      # entity, state machine, service with the atomic transitions
  checkout/    # DTO, Checkout Session creation
  webhooks/    # controller + one handler per event type
  outbox/      # email queue with FOR UPDATE SKIP LOCKED
  audit-log/   # serializer with a positive allowlist
public/        # static frontend
```

## Tests

```bash
npm test
```

66 tests covering the state machine, the webhook handlers, the services, and the controllers. The `orders.service` and webhook handler tests are integration tests: they run against a real Postgres (`TEST_DATABASE_URL`), not mocks.
