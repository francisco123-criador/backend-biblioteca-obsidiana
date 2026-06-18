# Biblioteca Obsidiana V2.0

## O que foi implementado

- 2 admins fixos vitalícios:
  - jerbinho1994@gmail.com / 8179
  - aliffe22022@gmail.com / 9995
- Possibilidade de adicionar novos admins pelo painel.
- Primeiros 100 cadastros recebem 30 dias grátis.
- Do 101º em diante, usuário cria conta mas precisa pagar.
- Renovação automática via Mercado Pago webhook.
- Painel admin online usando Supabase.
- Tokens secretos somente no Render.

## Ordem de instalação

1. Supabase SQL Editor:
   - execute `supabase_biblioteca_obsidiana_v2_0.sql`

2. GitHub backend:
   - substitua seu `server.js` por este novo.
   - substitua `package.json` se necessário.
   - commit na branch main.

3. Render:
   - confirme variáveis:
     - SUPABASE_URL
     - SUPABASE_SERVICE_ROLE_KEY
     - MERCADOPAGO_ACCESS_TOKEN
     - SITE_URL
     - BACKEND_PUBLIC_URL
     - SESSION_SECRET

4. GitHub Pages:
   - substitua o HTML pelo `biblioteca_obsidiana_v2_0_online.html`.
