# Catraca Financeira

API de doações construída para testar, na prática, uma integração séria com o Stripe: assinatura de webhook verificada, idempotência real, e uma máquina de estados que só aceita as transições que fazem sentido. É um projeto de portfólio. A doação é fictícia, mas o pagamento passa pelo Stripe de verdade, em modo teste.

O frontend é vanilla de propósito, porque o ponto aqui é o backend de pagamento. Mesmo assim tem identidade própria: o valor da doação aparece como um contador mecânico, tipo odômetro, não como um número dentro de um card.

## Como funciona

O visitante escolhe um valor fixo (R$ 20,00) ou digita um valor livre entre R$ 5,00 e R$ 1.000.000,00. O backend cria o pedido como `pending`, abre uma Checkout Session no Stripe e redireciona. O Stripe devolve o resultado por webhook, e a partir daí o pedido só pode seguir um destes caminhos:

```
pending ──► paid ──► refunded
   └──────► failed
```

Cada transição é um `UPDATE ... WHERE id = $1 AND status = $2` atômico. Não existe leitura-depois-escrita em nenhum ponto do fluxo de pagamento. Se dois eventos chegam ao mesmo tempo, só um vence. O outro vira um no-op silencioso e auditado, nunca um erro.

## O que o webhook trata

- `checkout.session.completed` e `payment_intent.succeeded` fazem a mesma transição, `pending → paid`. O Stripe não garante ordem de entrega entre os dois, então os dois handlers competem pela mesma linha: quem chegar primeiro vence, o outro é ignorado.
- `checkout.session.expired` e `payment_intent.payment_failed` levam para `failed`.
- `charge.refunded` cobre reembolso total (`paid → refunded`) e parcial (o pedido continua `paid`, só o valor reembolsado é atualizado, e nunca sobrescrito por um valor menor caso os eventos cheguem fora de ordem).

Todo evento passa pela verificação de assinatura antes de qualquer outra coisa, usando o corpo bruto da requisição. A rota de webhook fica fora do parser JSON global, porque a assinatura só bate contra os bytes exatos que o Stripe enviou. Assinatura inválida devolve 400 e grava um registro de auditoria; nada é persistido. A idempotência vem de uma constraint `UNIQUE` no `event_id` do Stripe: um evento reenviado é detectado antes de qualquer lógica de negócio rodar.

## Segurança

- Nenhum dado de cartão passa pelo backend em nenhum momento — isso é papel do Stripe.
- O log de auditoria (`audit_log`) é append-only, escrito numa transação separada da principal, com allowlist positiva de campos. Nunca um spread do evento do Stripe inteiro.
- Segredos (chave da Stripe, secret do webhook, credenciais do banco) nunca aparecem em log, em nenhum nível.
- A aplicação recusa subir se faltar uma variável de ambiente obrigatória, validado via Joi antes de qualquer coisa.
- `ValidationPipe` global com `whitelist` e `forbidNonWhitelisted`: campo extra no corpo da requisição é rejeitado, não ignorado.
- Rate limiting em todos os endpoints públicos.
- Moeda sempre fixada no backend (BRL). O cliente nunca escolhe.

## Stack

NestJS 10 + TypeScript, PostgreSQL via TypeORM, SDK oficial do Stripe, `class-validator`, Joi para validação de ambiente, Jest para os testes. Frontend em HTML/CSS/JS puro, sem framework e sem etapa de build.

## Rodando localmente

Pré-requisitos: Node 20+, Docker.

```bash
npm install
cp .env.example .env   # preencha as chaves de teste do Stripe
docker compose up -d   # Postgres + Mailpit (captura de email local)
npm run typeorm:run    # aplica a migration
npm run start:dev
```

O servidor sobe em `http://localhost:3000` (ou a porta definida em `PORT`).

Para testar o fluxo de webhook localmente, com o [Stripe CLI](https://stripe.com/docs/stripe-cli) instalado:

```bash
stripe listen --forward-to localhost:3000/webhooks/stripe
```

Cole o `whsec_...` que o comando imprime em `STRIPE_WEBHOOK_SECRET`, no `.env`.

### Variáveis de ambiente

| Variável | Descrição |
|---|---|
| `PORT` | Porta HTTP (padrão 3000) |
| `DATABASE_URL` | Conexão com o Postgres |
| `TEST_DATABASE_URL` | Banco separado para os testes de integração. Nunca aponte para o mesmo banco do `DATABASE_URL`: os testes rodam `DELETE FROM orders` |
| `STRIPE_SECRET_KEY` | Chave secreta do Stripe (modo teste) |
| `STRIPE_WEBHOOK_SECRET` | Secret de assinatura do webhook |
| `STRIPE_ALLOWED_PRICE_IDS` | Price IDs aceitos para doação de valor fixo, separados por vírgula |
| `MIN_DONATION_CENTS` / `MAX_DONATION_CENTS` | Limites do valor livre, em centavos |
| `FRONTEND_ORIGIN` | Origem permitida no CORS, também usada nas URLs de retorno do Checkout |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` | Envio do email de confirmação |
| `OUTBOX_MAX_ATTEMPTS` | Tentativas antes de marcar um email como falho |

## Endpoints

| Método | Rota | O que faz |
|---|---|---|
| `POST` | `/checkout/sessions` | Cria o pedido e a Checkout Session, devolve a URL de redirecionamento |
| `GET` | `/orders/:id/status` | Consulta o status do pedido pelo UUID — só o status, nada mais |
| `POST` | `/webhooks/stripe` | Recebe os eventos do Stripe |

## Estrutura

```
src/
  orders/      # entidade, máquina de estados, service com as transições atômicas
  checkout/    # DTO, criação da Checkout Session
  webhooks/    # controller + handler por tipo de evento
  outbox/      # fila de email com FOR UPDATE SKIP LOCKED
  audit-log/   # serializer com allowlist positiva
public/        # frontend estático
```

## Testes

```bash
npm test
```

66 testes cobrindo a máquina de estados, os handlers de webhook, os services e os controllers. Os testes de `orders.service` e dos handlers de webhook são de integração: rodam contra um Postgres de verdade (`TEST_DATABASE_URL`), não contra mocks.
