# Task 20 — Roteiro de verificação E2E com Stripe CLI

Status do código: Tasks 1-19 concluídas, Checkpoint 5 (revisão de segurança global) executado
sem achados pendentes, `package-lock.json` versionado. Esta é a última etapa do plano
(`docs/superpowers/plans/2026-09-16-payment-api-implementation.md`, Task 20) e depende de
credenciais e login interativo do Stripe que só você pode fornecer, por isso está documentada
aqui para execução manual em vez de automatizada.

## 0. Pré-requisitos (uma vez)

1. **Instalar o Stripe CLI** (não está instalado nesta máquina):
   - Windows via Scoop: `scoop install stripe`
   - Ou baixar o binário em https://github.com/stripe/stripe-cli/releases/latest e colocar no PATH.
   - Confirmar: `stripe --version`

2. **Login no Stripe CLI** (abre o navegador, usa sua conta Stripe em modo teste):
   ```
   stripe login
   ```

3. **Criar um produto/preço de teste** no Dashboard (modo teste) ou via CLI, e anotar o `price_id`
   (formato `price_...`). Você precisa de pelo menos um price ativo para o fluxo "fixed".

4. **Preencher `.env`** no worktree (`D:\Projetos\paymentValidation\.worktrees\payment-api-implementation\.env`)
   substituindo os placeholders:
   ```
   STRIPE_SECRET_KEY=sk_test_...        # sua chave secreta de teste (Dashboard > Developers > API keys)
   STRIPE_WEBHOOK_SECRET=whsec_...      # preenchido no passo 1 abaixo, depois de rodar `stripe listen`
   STRIPE_ALLOWED_PRICE_IDS=price_...   # o(s) price_id(s) criado(s) acima, separados por vírgula
   ```
   Opcional: configure `SMTP_HOST`/`SMTP_PORT` para um mail catcher local (ex: MailHog via
   `docker run -p 1025:1025 -p 8025:8025 mailhog/mailhog`) para inspecionar visualmente os e-mails
   de confirmação de doação.

## 1. Subir a stack

```
cd D:\Projetos\paymentValidation\.worktrees\payment-api-implementation
docker compose up -d
npm run typeorm:run
```

Em um terminal separado:
```
stripe listen --forward-to localhost:3000/webhooks/stripe
```
Copie o `whsec_...` impresso por esse comando para `STRIPE_WEBHOOK_SECRET` no `.env`.

Em outro terminal:
```
npm run start:dev
```
Aguarde "Nest application successfully started".

## 2. Happy path (Passo 2 do plano)

1. Abra `http://localhost:3000/index.html` no navegador.
2. Clique em "Doar valor fixo" (usa o primeiro `STRIPE_ALLOWED_PRICE_IDS`).
3. No Checkout hospedado da Stripe, use o cartão de teste `4242 4242 4242 4242`, validade/CVC
   quaisquer futuros, CEP qualquer.
4. Confirme o redirecionamento para `success.html?order=<uuid>` e que a mensagem muda para
   "Doação confirmada! Obrigado." em poucos segundos.
5. Verifique no banco (via `psql` ou client):
   ```sql
   SELECT id, status, amount_cents, donor_email, stripe_payment_intent_id FROM orders ORDER BY created_at DESC LIMIT 1;
   SELECT * FROM email_outbox ORDER BY created_at DESC LIMIT 1;   -- status deve virar 'sent' em ~10s
   SELECT * FROM audit_log ORDER BY created_at DESC LIMIT 5;
   ```
   Confirme: `status = 'paid'`, `donor_email` preenchido, `email_outbox.status = 'sent'`,
   entradas em `audit_log` para o evento.

## 3. Custom amount path (Passo 3)

Repita o fluxo pelo formulário de "Outro valor (R$)" com um valor customizado (ex: R$ 37,50).
Confirme os mesmos resultados acima e que `orders.amount_cents` bate exatamente com o valor
cobrado (3750).

## 4. Failure path (Passo 4)

Duas opções:
- Inicie um checkout e **não complete** o pagamento; aguarde a sessão expirar (padrão Stripe:
  24h — inviável para teste manual rápido), OU
- Use `stripe trigger checkout.session.expired` apontando para uma sessão pendente real. Se o
  CLI não permitir associar a um `pending` order específico, crie uma pending order via
  `POST /checkout/sessions` e então dispare o evento sintético:
  ```
  stripe trigger checkout.session.expired
  ```
Confirme que a order correspondente transiciona para `status = 'failed'`.

## 5. Refund path (Passo 5)

Com uma order já `paid` (do passo 2 ou 3):

**Reembolso total:**
```
stripe trigger charge.refunded
```
Confirme `status = 'refunded'`.

**Reembolso parcial:** no Dashboard (modo teste) > Payments > selecione o charge > "Refund" >
informe um valor menor que o total. Confirme que a order **permanece** `paid` mas
`refunded_amount_cents` foi atualizado para o valor parcial.

## 6. Replay/duplicate path (Passo 6)

Pegue o `event_id` (formato `evt_...`) de um evento já processado (ex: o `checkout.session.completed`
do passo 2 — visível no output do `stripe listen` ou no Dashboard > Developers > Events) e reenvie:
```
stripe events resend evt_...
```
Confirme:
```sql
SELECT * FROM processed_stripe_events WHERE event_id = 'evt_...';
SELECT * FROM audit_log WHERE event_id = 'evt_...' ORDER BY created_at DESC;
```
`outcome`/`audit_log` devem indicar `duplicate` e a order **não** deve mudar de estado.

## 7. Tampered signature path (Passo 7)

Com o servidor rodando, envie uma requisição com assinatura inválida:

PowerShell:
```powershell
Invoke-WebRequest -Uri http://localhost:3000/webhooks/stripe `
  -Method POST `
  -Headers @{ "Stripe-Signature" = "t=1,v1=invalidsignature" } `
  -ContentType "application/json" `
  -Body '{"id":"evt_fake","type":"checkout.session.completed"}'
```

Ou via curl (Git Bash):
```bash
curl -i -X POST http://localhost:3000/webhooks/stripe \
  -H "Stripe-Signature: t=1,v1=invalidsignature" \
  -H "Content-Type: application/json" \
  -d '{"id":"evt_fake","type":"checkout.session.completed"}'
```

Confirme:
- Resposta `400`.
- `SELECT * FROM audit_log WHERE action = 'signature_invalid' ORDER BY created_at DESC LIMIT 1;`
  retorna a entrada correspondente.
- `SELECT * FROM processed_stripe_events WHERE event_id = 'evt_fake';` retorna **zero linhas**
  (nenhum registro deve ter sido criado para um evento com assinatura inválida).

## 8. Registrar resultados

Para cada passo (2-7), anote PASS/FAIL. Qualquer discrepância do comportamento esperado deve
virar uma task de fix separada antes de considerar o MVP completo — não corrija "no calor do
momento" sem antes registrar o que quebrou e por quê.

Ao concluir, marque a Task 20 como feita no plano principal
(`docs/superpowers/plans/2026-09-16-payment-api-implementation.md`) e faça commit apenas se o
plano ganhar alguma edição textual (ex: registrar o resultado do checkpoint); não há código novo
esperado neste passo, a menos que a verificação revele um bug real.
