# API de Pagamento (Stripe Webhook) — Design Spec

Data: 2026-09-16
Status: Aprovado para implementação

## Contexto e objetivo

Projeto de portfólio: API de pagamento para site de doação/produto único
("catraca financeira"), integrada ao Stripe Checkout via webhook.
Prioridade #1 é segurança — cada decisão de design passou por análise
explícita de ameaças (STRIDE) antes de ser aprovada.

**Stack:** NestJS + TypeScript, PostgreSQL, Stripe (test mode + Stripe CLI
para desenvolvimento local), frontend estático vanilla HTML/CSS/JS.

**Escopo do MVP:**
- Checkout com valor fixo (Price ID pré-cadastrado) OU valor livre
  (doação com min/max validado no backend)
- Webhook tratando o ciclo completo: `pending -> paid -> failed | refunded`
  (incluindo refund parcial e total)
- Confirmação por e-mail via outbox pattern (best-effort, não bloqueia o
  webhook)
- Endpoint de consulta de status por UUID (sem dados sensíveis)
- **Fora de escopo:** área administrativa, autenticação de usuário,
  múltiplos produtos, filas externas (Redis/BullMQ)

## Threat model (STRIDE + Replay)

Ver análise completa apresentada e validada em brainstorming. Resumo das
mitigações centrais, cada uma referenciada no design abaixo:

| Categoria | Ameaças-chave | Mitigação central |
|---|---|---|
| Spoofing | Payload forjado; amount manipulado pelo client | Verificação de assinatura Stripe; price/amount nunca confiados do client sem validação server-side |
| Tampering | Payload alterado em trânsito; raw body corrompido pela verificação de assinatura | HTTPS; raw body dedicado só na rota de webhook, sem `bodyParser.json()` global |
| Repudiation | Sem prova de que evento foi recebido/processado/rejeitado | `audit_log` append-only, escrito em transação separada, best-effort com fallback stderr |
| Information Disclosure | Dados de cartão persistidos; secrets vazando em logs/erros; IDs enumeráveis | Nunca persistir payload bruto; allowlist positiva de campos logados; UUID como identificador público; exception filter genérico |
| DoS | Flood nos endpoints públicos; processamento pesado por evento | Rate limiting (`@nestjs/throttler`); verificação de assinatura fail-fast antes de tocar o banco |
| Elevation of Privilege | Transições de estado arbitrárias; reuso de session_id entre pedidos | State machine com transições explícitas via UPDATE atômico; vínculo 1:1 `stripe_session_id` <-> `order_id` |
| Replay | Reenvio de evento antigo capturado; reenvio legítimo duplicado do Stripe | Tolerância de timestamp da lib Stripe; idempotência via `event_id` UNIQUE |

## Modelo de dados

```sql
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
);

CREATE TABLE processed_stripe_events (
  event_id      varchar PRIMARY KEY,
  event_type    varchar NOT NULL,
  order_id      uuid NULL REFERENCES orders(id),
  received_at   timestamptz NOT NULL DEFAULT now(),
  outcome       varchar NOT NULL CHECK (outcome IN ('processed','rejected','duplicate'))
);

CREATE TABLE audit_log (
  id          bigserial PRIMARY KEY,
  event_id    varchar NULL,
  order_id    uuid NULL REFERENCES orders(id),
  action      varchar NOT NULL,
  detail      jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE email_outbox (
  id          bigserial PRIMARY KEY,
  order_id    uuid NOT NULL REFERENCES orders(id),
  status      varchar NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending','sent','failed')),
  attempts    integer NOT NULL DEFAULT 0,
  last_error  text NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  sent_at     timestamptz NULL
);
```

### Máquina de estados

Transições válidas (qualquer outra é rejeitada e auditada, nunca aplicada
silenciosamente):

```
pending -> paid       (checkout.session.completed | payment_intent.succeeded)
pending -> failed     (checkout.session.expired | payment_intent.payment_failed)
paid    -> refunded   (charge.refunded, apenas se amount_refunded == amount_cents)
```

Refund parcial (`amount_refunded < amount_cents`) **não** transiciona o
status — apenas atualiza `refunded_amount_cents` e gera
`audit_log.action = 'partial_refund_recorded'`.

Toda transição é um `UPDATE` atômico com o estado de origem no `WHERE`:

```sql
UPDATE orders SET status = 'paid', updated_at = now()
WHERE id = $1 AND status = 'pending';
-- rowCount = 0 => transição inválida/já aplicada; log, não é erro fatal
```

`stripe_session_id` UNIQUE garante vínculo estrito 1:1 entre sessão Stripe
e pedido interno. `processed_stripe_events.event_id` como PK garante
idempotência via `INSERT ... ON CONFLICT DO NOTHING`.

## API pública

```
POST /checkout/sessions
  body (DTO validado, whitelist estrita via ValidationPipe global):
    { productType: 'fixed' | 'custom', priceId?: string, amountCents?: number }
  - fixed: priceId deve estar em allowlist pré-cadastrada em config (não no body livre)
  - custom: amountCents deve ser inteiro, MIN_DONATION_CENTS <= x <= MAX_DONATION_CENTS
  - currency é sempre fixado no backend (nunca aceito do client)
  - cria order (status='pending') ANTES de chamar Stripe
  - chama stripe.checkout.sessions.create(...), atualiza order com stripe_session_id
  - retorna { checkoutUrl }
  - rate limit: 10 req/min/IP

GET /orders/:id/status
  - :id é o uuid interno do order
  - retorna apenas { status }
  - rate limit: 30 req/min/IP

POST /webhooks/stripe
  - único endpoint que recebe callbacks do Stripe
  - raw body (express.raw, sem bodyParser.json() global nesta rota)
  - rate limit: 100 req/min/IP
```

### Fluxo end-to-end

1. Frontend (`index.html`) chama `POST /checkout/sessions` → recebe
   `checkoutUrl` → `window.location.href = checkoutUrl`
2. Usuário paga no Stripe Checkout
3. Stripe redireciona para `success_url` (`/success.html?order=<uuid>`)
   — `success.html` inclui `<meta name="referrer" content="no-referrer">`
   para o UUID não vazar via header Referer em recursos externos
4. `success.html` faz polling em `GET /orders/:id/status` (intervalo
   fixo, ex. 2s, teto de ~30 tentativas); ao esgotar o teto, trata como
   "ainda processando" (nunca como erro) e informa que a confirmação
   chegará por e-mail
5. Em paralelo, o Stripe chama `POST /webhooks/stripe` — **única fonte de
   verdade** para mudança de estado; o frontend nunca marca como pago
   por conta própria

## Processamento do webhook

```
1. Verificação de assinatura + timestamp (fora de transação, fail-fast):
   stripe.webhooks.constructEvent(rawBody, signatureHeader, webhookSecret)
   - falha => audit_log('signature_invalid' | 'timestamp_out_of_tolerance'),
     responde 400 genérico, retorna imediatamente (não toca o banco)

2. BEGIN (transação principal)
3.   INSERT processed_stripe_events (event_id, event_type, outcome='processed')
     ON CONFLICT (event_id) DO NOTHING
     -> 0 rows afetadas: ROLLBACK, outcome='duplicate', responde 200
4.   Handler do event.type (checkout-completed | payment-failed | charge-refunded):
     UPDATE atômico em orders (WHERE status = <esperado>)
     -> rowCount=0: não é erro, apenas log 'invalid_transition_rejected' dentro da tx
5.   Se transição para 'paid': INSERT email_outbox (status='pending')
6. COMMIT
   - exceção não tratada entre 2-6 => ROLLBACK completo (inclusive o INSERT de
     idempotência — o evento NÃO fica marcado como processado), responde 500
     (Stripe reenvia)
7. audit_log é escrito em transação/conexão SEPARADA da principal, após o
   resultado (commit ou rollback) ser conhecido — garante que falha no
   processamento principal não perde o registro de auditoria. Se a própria
   escrita de audit_log falhar, fallback best-effort para log estruturado
   em stderr; nunca derruba a resposta HTTP do webhook.
8. event.type não tratado (fora dos 5 handlers): log 'event_type_ignored',
   responde 200 (evita que o Stripe reenvie sem necessidade)
```

## Outbox de e-mail

Worker via `@nestjs/schedule` (cron a cada ~10s), sem dependência externa
de fila:

```sql
SELECT * FROM email_outbox
WHERE status = 'pending' AND attempts < MAX_ATTEMPTS
FOR UPDATE SKIP LOCKED
LIMIT 20
```

Para cada linha: tenta enviar via provider (SMTP/Resend/SendGrid) →
sucesso marca `sent`; falha incrementa `attempts` e grava `last_error`
sanitizado; ao atingir `MAX_ATTEMPTS`, marca `failed` e audita — nunca
afeta o status do pedido, que já está `paid` independentemente do e-mail.

## Segurança transversal

- **ValidationPipe global** (`whitelist: true, forbidNonWhitelisted: true,
  transform: true`) — rejeita campos não previstos no DTO em qualquer
  endpoint, não só checkout.
- **Helmet global** (`app.use(helmet())`) no bootstrap — CSP básica,
  `X-Content-Type-Options`, remoção de `X-Powered-By`, HSTS.
- **CORS restrito** a `FRONTEND_ORIGIN` (env obrigatória, validada no
  boot). Frontend é servido same-origin pelo próprio Nest
  (`ServeStaticModule`), então CORS não tem efeito prático nesse deploy —
  mantido mesmo assim como defesa em profundidade, documentado o motivo.
- **Exception filter global**: resposta ao cliente sempre genérica por
  categoria HTTP (`{ statusCode, message }`), nunca stack trace nem
  detalhe de SDK/driver. Log interno estruturado (Pino) recebe o erro
  completo.
- **Sanitização de `audit_log.detail`**: allowlist positiva — o serializer
  monta o objeto explicitamente campo a campo
  (`{ event_id, event_type, order_id, status, reason }`, omitindo os
  ausentes), nunca um spread do objeto de erro ou do evento Stripe bruto.
- **Secrets**: `.env` no `.gitignore` desde o primeiro commit,
  `.env.example` com placeholders. `ConfigModule` com validação de schema
  (Joi/zod) no boot — app falha ao subir se secret obrigatório estiver
  ausente. Nenhum secret é logado em nenhum nível.
- **Rate limiting** via `@nestjs/throttler`, limites por rota conforme
  seção de API pública acima.

## Estrutura de módulos

```
src/
  checkout/
    checkout.controller.ts
    checkout.service.ts
    dto/create-checkout-session.dto.ts
  webhooks/
    stripe-webhook.controller.ts
    stripe-webhook.service.ts
    handlers/
      checkout-completed.handler.ts
      payment-failed.handler.ts
      charge-refunded.handler.ts
  orders/
    orders.controller.ts
    orders.service.ts
    order-state-machine.ts
  outbox/
    email-outbox.service.ts
    email-outbox.processor.ts   -- @Cron
  audit-log/
    audit-log.service.ts        -- write-only, transação separada, serializer allowlist
  common/
    filters/http-exception.filter.ts
    config/                     -- validação de env no boot (Joi/zod)
```

Módulos dependem só de interfaces dos módulos vizinhos (ex.: `webhooks`
chama `orders.service` e `outbox.service` via injeção, nunca acessa o
repositório de `orders` diretamente).

## Frontend estático (`/public`, servido pelo Nest via ServeStaticModule)

```
index.html      -- botões de valor fixo + input de valor livre,
                    fetch POST /checkout/sessions, redirect pra checkoutUrl
success.html    -- <meta name="referrer" content="no-referrer">,
                    lê ?order=<uuid>, polling em GET /orders/:id/status
                    com teto de tentativas
cancel.html     -- checkout cancelado
style.css
checkout.js
status-poll.js
```

Sem build step, sem framework.

## Estratégia de testes (TDD red-green-refactor)

- `order-state-machine.ts`: testes unitários puros (sem DB), cada
  transição válida e cada inválida rejeitada
- `stripe-webhook.service`: assinatura válida/inválida/expirada via
  `stripe.webhooks.generateTestHeaderString`; idempotência (mesmo
  `event_id` duas vezes)
- Handlers de evento: testes de integração contra banco de teste real,
  validando os `UPDATE ... WHERE status=` atômicos e transições
  concorrentes/inválidas
- `checkout.service`: validação de input (amount fora do range, priceId
  fora da allowlist, moeda ignorada do body)
- Verificação manual/exploratória com Stripe CLI (`stripe listen
  --forward-to localhost:3000/webhooks/stripe`, `stripe trigger
  checkout.session.completed`) como end-to-end antes de fechar cada fatia

## Decisões registradas (para não reabrir sem motivo)

- Sem fila externa (Redis/BullMQ): outbox baseado em Postgres é
  suficiente pro escopo e evita infra extra.
- Sem área administrativa no MVP.
- Frontend same-origin com o backend (não hospedagem separada).
- E-mail de confirmação é sempre best-effort — nunca gatilho de mudança
  de estado do pedido.
