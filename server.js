// server.js — Biblioteca Obsidiana Backend
// Render/Railway/Vercel Node server
// Rotas:
// GET  /health
// POST /create-preference
// POST /mercadopago-webhook

import express from "express";
import cors from "cors";
import { MercadoPagoConfig, Preference, Payment } from "mercadopago";
import { createClient } from "@supabase/supabase-js";

const app = express();

app.use(cors({
  origin: "*"
}));

app.use(express.json());

const {
  MERCADOPAGO_ACCESS_TOKEN,
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  SITE_URL
} = process.env;

if (!MERCADOPAGO_ACCESS_TOKEN) console.warn("Falta MERCADOPAGO_ACCESS_TOKEN");
if (!SUPABASE_URL) console.warn("Falta SUPABASE_URL");
if (!SUPABASE_SERVICE_ROLE_KEY) console.warn("Falta SUPABASE_SERVICE_ROLE_KEY");

const mpClient = new MercadoPagoConfig({
  accessToken: MERCADOPAGO_ACCESS_TOKEN
});

const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY
);

function getPlanPrice(planDays) {
  const days = Number(planDays || 30);
  if (days === 90) return 49.90;
  if (days === 60) return 34.90;
  return 19.90;
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + Number(days || 30));
  return d.toISOString();
}

app.get("/", (req, res) => {
  res.json({
    ok: true,
    name: "Biblioteca Obsidiana Backend",
    routes: ["/health", "/create-preference", "/mercadopago-webhook"]
  });
});

app.get("/health", (req, res) => {
  res.json({ ok: true, status: "online" });
});

app.post("/create-preference", async (req, res) => {
  try {
    const { userEmail, planDays = 30 } = req.body || {};

    if (!userEmail) {
      return res.status(400).json({ error: "Falta userEmail." });
    }

    const price = getPlanPrice(planDays);
    const siteUrl = SITE_URL || "https://seu-site.github.io/Biblioteca-Obsidiana-1.0";

    const preference = new Preference(mpClient);

    const result = await preference.create({
      body: {
        items: [
          {
            title: `Biblioteca Obsidiana Premium - ${planDays} dias`,
            quantity: 1,
            currency_id: "BRL",
            unit_price: price
          }
        ],
        payer: {
          email: userEmail
        },
        metadata: {
          user_email: String(userEmail).toLowerCase(),
          plan_days: Number(planDays)
        },
        back_urls: {
          success: `${siteUrl}?payment=success`,
          failure: `${siteUrl}?payment=failure`,
          pending: `${siteUrl}?payment=pending`
        },
        notification_url: `${process.env.BACKEND_PUBLIC_URL}/mercadopago-webhook`,
        auto_return: "approved"
      }
    });

    res.json({
      ok: true,
      preference_id: result.id,
      init_point: result.init_point,
      sandbox_init_point: result.sandbox_init_point
    });
  } catch (error) {
    console.error("Erro create-preference:", error);
    res.status(500).json({ error: "Erro ao criar pagamento." });
  }
});

app.post("/mercadopago-webhook", async (req, res) => {
  try {
    const paymentId =
      req.body?.data?.id ||
      req.body?.id ||
      req.query?.id ||
      req.query?.["data.id"];

    if (!paymentId) {
      return res.status(200).json({ ok: true, message: "Webhook recebido sem paymentId." });
    }

    const payment = new Payment(mpClient);
    const info = await payment.get({ id: paymentId });

    if (info.status !== "approved") {
      return res.status(200).json({
        ok: true,
        payment_id: paymentId,
        status: info.status
      });
    }

    const userEmail = info.metadata?.user_email;
    const planDays = Number(info.metadata?.plan_days || 30);

    if (!userEmail) {
      return res.status(400).json({ error: "Pagamento aprovado, mas sem user_email no metadata." });
    }

    const expiresAt = addDays(new Date(), planDays);

    const { error } = await supabase
      .from("profiles")
      .upsert({
        email: String(userEmail).toLowerCase(),
        role: "user",
        status: "active",
        plan_days: planDays,
        expires_at: expiresAt,
        last_payment_id: String(paymentId)
      }, { onConflict: "email" });

    if (error) throw error;

    res.json({
      ok: true,
      message: "Acesso liberado/renovado.",
      email: userEmail,
      expires_at: expiresAt
    });
  } catch (error) {
    console.error("Erro webhook:", error);
    res.status(500).json({ error: "Erro ao processar webhook." });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Biblioteca Obsidiana backend online na porta ${port}`);
});
