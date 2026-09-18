# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Static HTML/CSS/JS frontend (vanilla, no framework, no build step) served
same-origin from a NestJS + PostgreSQL backend. This is an existing,
deliberate constraint — not open for a build-tool recommendation.

## Users

- **Recrutadores e avaliadores técnicos** revisando o portfólio, avaliando
  a qualidade da integração de pagamento e a atenção a segurança/detalhe.
- **Usuários reais simulando uma doação de teste** (fluxo de checkout via
  Stripe em modo teste, ponta a ponta).

## Product Purpose

"Catraca financeira" — um site de doação/produto único que demonstra uma
integração segura e completa com o Stripe (Checkout + webhook), como peça
de portfólio técnico. O produto em si (doações) é fictício; o que importa
é a qualidade da implementação de pagamento.

## Positioning

Não é uma landing page de SaaS nem uma vitrine de produto — é a prova de
uma integração de pagamento tratada com rigor de produção: verificação de
assinatura do webhook, idempotência, state machine auditável, e um
frontend que se comporta como parte de um sistema de pagamento sério, não
como uma peça de marketing.

## Operating Context

- Fluxo de doação com valor fixo (Price ID) ou valor livre (min/max
  validado no backend).
- Checkout hospedado pelo Stripe (redirecionamento), com páginas de
  retorno `success.html` (polling de status) e `cancel.html`.
- Ambiente de desenvolvimento local via Stripe CLI (`stripe listen`,
  `stripe trigger`) para o fluxo completo `pending -> paid -> failed |
  refunded`.

## Capabilities and Constraints

- Frontend: HTML/CSS/JS puro, sem framework, sem etapa de build — qualquer
  sugestão de design deve permanecer dentro dessa restrição.
- Backend (fora de escopo do trabalho visual, mas contexto factual):
  NestJS + TypeORM + PostgreSQL, webhook Stripe assinado e idempotente.
- Fora de escopo de produto: área administrativa, autenticação de
  usuário, múltiplos produtos, filas externas.
- Moeda fixa no backend (BRL); nunca aceita do cliente.

## Brand Commitments

- Tom/voz: confiável e direto — como um sistema de pagamento sério, não
  uma landing page de SaaS. Evitar clichês de "SaaS genérico" (gradiente
  roxo-azul, ícone em tile arredondado sobre o título, cards dentro de
  cards).
- Rodapé discreto obrigatório em todas as páginas com o crédito:
  "Desenvolvido por Everton Medola", linkando para
  https://github.com/evertonmedola (ou evertonmedola.github.io, o que
  fizer mais sentido no layout escolhido).

## Evidence on Hand

- Nenhuma organização, empresa ou dado de contato real deve ser inventado
  além do crédito de autoria acima — é uma doação fictícia para fins de
  demonstração, não um negócio real.
- Preço de teste real já provisionado no Stripe (modo sandbox): produto
  "Doação -- Apoio ao projeto", price `price_1UGVKsPZIC97Rc8FKldtX4jf`
  (R$ 20,00 BRL) — usado pelo botão de valor fixo.

## Product Principles

1. Segurança e rigor de produção vêm antes de estética — o frontend deve
   parecer parte de um sistema de pagamento confiável, nunca uma vitrine.
2. Zero dependência de build tooling ou framework no frontend, mesmo sob
   pressão por "modernizar" a stack.
3. Nenhum dado, organização ou prova social fictícia além do crédito de
   autoria explicitamente autorizado.
4. O produto (doação) é fictício, mas a integração de pagamento deve se
   comportar e parecer real e correta em cada estado (pending/paid/
   failed/refunded).

## Accessibility & Inclusion

Sem requisito formal de WCAG, mas seguir boas práticas por padrão:
contraste adequado (mínimo AA), foco visível em todos os elementos
interativos, e `aria-label`/roles apropriados em mensagens de status e
erro.
