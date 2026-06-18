# Backend Biblioteca Obsidiana — Render

## Como subir no Render

1. Crie um repositório no GitHub.
2. Envie estes arquivos:
   - server.js
   - package.json
   - .env.example
3. No Render:
   - New Web Service
   - conecte o repositório
   - Build Command: `npm install`
   - Start Command: `npm start`
4. Em Environment Variables, adicione:
   - MERCADOPAGO_ACCESS_TOKEN
   - SUPABASE_URL
   - SUPABASE_SERVICE_ROLE_KEY
   - BACKEND_PUBLIC_URL
   - SITE_URL
5. Depois de publicar, teste:
   - https://seu-backend.onrender.com/health

## Rotas

POST /create-preference

Body:
{
  "userEmail": "cliente@email.com",
  "planDays": 30
}

POST /mercadopago-webhook

O Mercado Pago chama automaticamente esta rota quando o pagamento muda de status.
