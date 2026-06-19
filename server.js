// server.js — Biblioteca Obsidiana Backend V2.4.3
import express from "express";
import cors from "cors";
import crypto from "crypto";
import { MercadoPagoConfig, Preference, Payment } from "mercadopago";
import { createClient } from "@supabase/supabase-js";

const app = express();
app.use(cors({ origin: "*" }));
app.use(express.json());

const {
  MERCADOPAGO_ACCESS_TOKEN,
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  SITE_URL,
  BACKEND_PUBLIC_URL,
  SESSION_SECRET = "troque-essa-chave-no-render"
} = process.env;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const mpClient = new MercadoPagoConfig({ accessToken: MERCADOPAGO_ACCESS_TOKEN });

const PIN_SALT = "biblioteca-obsidiana-v2|";
const FIXED_ADMIN_EMAILS = ["jerbinho1994@gmail.com", "aliffe22022@gmail.com"];
const FIXED_ADMINS = [
  { email: "jerbinho1994@gmail.com", pin: "8179" },
  { email: "aliffe22022@gmail.com", pin: "9995" }
];

function normEmail(email){ return String(email || "").trim().toLowerCase(); }
function validPin(pin){ return /^\d{4}$/.test(String(pin || "")); }
function hashPin(pin){ return crypto.createHash("sha256").update(PIN_SALT + String(pin)).digest("hex"); }
function addDays(date, days){ const d = new Date(date); d.setDate(d.getDate() + Number(days || 30)); return d.toISOString(); }
function isFixedAdminEmail(email){ return FIXED_ADMIN_EMAILS.includes(normEmail(email)); }

async function getPlanPrice(days){
  days = Number(days || 30);

  const { data, error } = await supabase
    .from("bo_plan_prices")
    .select("*")
    .eq("plan_days", days)
    .maybeSingle();

  if(error || !data){
    if(days === 90) return 49.90;
    if(days === 60) return 34.90;
    return 19.90;
  }

  const now = Date.now();
  const promoActive =
    data.promo_price_cents &&
    data.promo_starts_at &&
    data.promo_ends_at &&
    new Date(data.promo_starts_at).getTime() <= now &&
    new Date(data.promo_ends_at).getTime() >= now;

  const cents = promoActive ? data.promo_price_cents : data.normal_price_cents;
  return Number(cents) / 100;
}

function signToken(payload){
  const body = Buffer.from(JSON.stringify({ ...payload, iat: Date.now() })).toString("base64url");
  const sig = crypto.createHmac("sha256", SESSION_SECRET).update(body).digest("base64url");
  return body + "." + sig;
}

function verifyToken(token){
  if(!token || !token.includes(".")) return null;
  const [body, sig] = token.split(".");
  const expected = crypto.createHmac("sha256", SESSION_SECRET).update(body).digest("base64url");
  try{
    if(!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    return JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  }catch{ return null; }
}

async function requireAuth(req, res, next){
  const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const data = verifyToken(token);
  if(!data?.email) return res.status(401).json({ ok:false, error:"Sessão inválida." });

  const { data: profile, error } = await supabase
    .from("bo_profiles")
    .select("*")
    .eq("email", normEmail(data.email))
    .single();

  if(error || !profile) return res.status(401).json({ ok:false, error:"Usuário não encontrado." });
  req.profile = profile;
  next();
}

async function requireAdmin(req, res, next){
  await requireAuth(req, res, async () => {
    if(req.profile.role !== "admin") return res.status(403).json({ ok:false, error:"Apenas admin." });
    next();
  });
}

async function seedFixedAdmins(){
  for(const a of FIXED_ADMINS){
    await supabase.from("bo_profiles").upsert({
      email: normEmail(a.email),
      pin_hash: hashPin(a.pin),
      role: "admin",
      status: "active",
      is_fixed_admin: true,
      is_lifetime: true,
      free_trial_granted: false,
      plan_days: 9999,
      expires_at: "2099-12-31T23:59:59.000Z",
      updated_at: new Date().toISOString()
    }, { onConflict: "email" });
  }
}
seedFixedAdmins().catch(e => console.error("Erro ao criar admins fixos:", e));

app.get("/", (req, res) => res.json({ ok:true, name:"Biblioteca Obsidiana Backend V2.4.3" }));
app.get("/health", (req, res) => res.json({ ok:true, status:"online", version:"2.4.3" }));

app.get("/public/free-slots", async (req, res) => {
  const { count, error } = await supabase
    .from("bo_profiles")
    .select("*", { count:"exact", head:true })
    .eq("free_trial_granted", true)
    .neq("created_by", "free_promo");

  if(error) return res.status(500).json({ ok:false, error:error.message });

  const used = Number(count || 0);
  res.json({ ok:true, free_used: used, free_remaining: Math.max(0, 100 - used), free_limit: 100 });
});

app.post("/signup", async (req, res) => {
  try{
    const email = normEmail(req.body.email);
    const whatsapp = String(req.body.whatsapp || "").trim();
    const pin = String(req.body.pin || "").trim();

    if(!email || !email.includes("@")) return res.status(400).json({ ok:false, error:"E-mail inválido." });
    if(!validPin(pin)) return res.status(400).json({ ok:false, error:"A senha precisa ter 4 números." });

    const { data: existing } = await supabase.from("bo_profiles").select("*").eq("email", email).maybeSingle();
    if(existing) return res.status(409).json({ ok:false, error:"Este e-mail já está cadastrado." });

    const { count } = await supabase
      .from("bo_profiles")
      .select("*", { count:"exact", head:true })
      .eq("free_trial_granted", true)
      .neq("created_by", "free_promo");

    const freeUsed = Number(count || 0);

    if(freeUsed < 100){
      const freeTrialNumber = freeUsed + 1;

      const profile = {
        email,
        whatsapp,
        pin_hash: hashPin(pin),
        role:"user",
        status:"active",
        is_fixed_admin:false,
        is_lifetime:false,
        free_trial_granted:true,
        free_trial_number:freeTrialNumber,
        plan_days:30,
        expires_at:addDays(new Date(), 30),
        created_by:"self",
        updated_at:new Date().toISOString()
      };

      const { data, error } = await supabase.from("bo_profiles").insert(profile).select("*").single();
      if(error) throw error;

      const token = signToken({ email:data.email, role:data.role });

      return res.json({
        ok:true,
        profile:data,
        token,
        freeTrialGranted:true,
        freeTrialNumber,
        freeRemaining: Math.max(0, 100 - freeTrialNumber)
      });
    }

    const nowIso = new Date().toISOString();

    const { data: promo } = await supabase
      .from("bo_free_access_promos")
      .select("*")
      .eq("enabled", true)
      .lte("starts_at", nowIso)
      .gte("ends_at", nowIso)
      .order("created_at", { ascending:false })
      .limit(1)
      .maybeSingle();

    if(promo && Number(promo.used_slots || 0) < Number(promo.extra_slots || 0)){
      const days = Number(promo.free_days || 30);

      const profile = {
        email,
        whatsapp,
        pin_hash: hashPin(pin),
        role:"user",
        status:"active",
        is_fixed_admin:false,
        is_lifetime:false,
        free_trial_granted:true,
        free_trial_number:null,
        plan_days:days,
        expires_at:addDays(new Date(), days),
        created_by:"free_promo",
        updated_at:new Date().toISOString()
      };

      const { data, error } = await supabase.from("bo_profiles").insert(profile).select("*").single();
      if(error) throw error;

      await supabase
        .from("bo_free_access_promos")
        .update({
          used_slots:Number(promo.used_slots || 0) + 1,
          updated_at:new Date().toISOString()
        })
        .eq("id", promo.id);

      const token = signToken({ email:data.email, role:data.role });

      return res.json({
        ok:true,
        profile:data,
        token,
        freeTrialGranted:true,
        freePromoGranted:true,
        message:"Acesso grátis promocional liberado."
      });
    }

    return res.json({
      ok:true,
      paymentRequired:true,
      message:"Os 100 acessos grátis acabaram. Continue para o pagamento.",
      email,
      whatsapp
    });

  }catch(error){
    console.error(error);
    res.status(500).json({ ok:false, error:"Erro ao cadastrar: " + error.message });
  }
});

app.post("/login", async (req, res) => {
  try{
    const email = normEmail(req.body.email);
    const pin = String(req.body.pin || "").trim();

    const { data: profile, error } = await supabase.from("bo_profiles").select("*").eq("email", email).single();

    if(error || !profile) return res.status(401).json({ ok:false, error:"Conta não encontrada." });
    if(profile.pin_hash !== hashPin(pin)) return res.status(401).json({ ok:false, error:"Senha incorreta." });
    if(profile.status === "blocked") return res.status(403).json({ ok:false, error:"Conta bloqueada pelo admin." });

    const token = signToken({ email:profile.email, role:profile.role });
    await supabase.from("bo_profiles").update({ last_login_at:new Date().toISOString() }).eq("email", profile.email);

    res.json({ ok:true, profile, token });
  }catch(error){
    console.error(error);
    res.status(500).json({ ok:false, error:"Erro ao entrar." });
  }
});

app.get("/me", requireAuth, (req, res) => {
  res.json({ ok:true, profile:req.profile });
});

app.post("/create-preference", async (req, res) => {
  try{
    const userEmail = normEmail(req.body.userEmail);
    const planDays = Number(req.body.planDays || 30);
    const whatsapp = String(req.body.whatsapp || "").trim();
    const pin = String(req.body.pin || "").trim();

    if(!userEmail) return res.status(400).json({ ok:false, error:"Falta userEmail." });
    if(![30,60,90].includes(planDays)) return res.status(400).json({ ok:false, error:"Plano inválido." });

    const { data: existing } = await supabase
      .from("bo_profiles")
      .select("*")
      .eq("email", userEmail)
      .maybeSingle();

    if(!existing && !validPin(pin)){
      return res.status(400).json({ ok:false, error:"Para criar conta paga, informe uma senha de 4 números." });
    }

    const price = await getPlanPrice(planDays);

    const siteUrl = SITE_URL || "https://francisco123-criador.github.io/Biblioteca-Obsidiana-1.0";
    const backendUrl = BACKEND_PUBLIC_URL || "https://backend-biblioteca-obsidiana.onrender.com";

    const preference = new Preference(mpClient);

    const metadata = {
      user_email:userEmail,
      plan_days:planDays,
      whatsapp,
      pin_hash: existing?.pin_hash || hashPin(pin)
    };

    const result = await preference.create({
      body: {
        items: [{
          title:`Biblioteca Obsidiana Premium - ${planDays} dias`,
          quantity:1,
          currency_id:"BRL",
          unit_price:price
        }],
        payer: { email:userEmail },
        metadata,
        back_urls: {
          success:`${siteUrl}?payment=success`,
          failure:`${siteUrl}?payment=failure`,
          pending:`${siteUrl}?payment=pending`
        },
        notification_url: `${backendUrl}/mercadopago-webhook`,
        auto_return: "approved"
      }
    });

    res.json({
      ok:true,
      price,
      preference_id:result.id,
      init_point:result.init_point,
      sandbox_init_point:result.sandbox_init_point
    });
  }catch(error){
    console.error(error);
    res.status(500).json({ ok:false, error:"Erro ao criar pagamento: " + error.message });
  }
});

app.post("/mercadopago-webhook", async (req, res) => {
  try{
    const paymentId = req.body?.data?.id || req.body?.id || req.query?.id || req.query?.["data.id"];

    if(!paymentId) return res.status(200).json({ ok:true, message:"Webhook sem paymentId." });

    const payment = new Payment(mpClient);
    const info = await payment.get({ id: paymentId });

    if(info.status !== "approved"){
      return res.status(200).json({ ok:true, payment_id:paymentId, status:info.status });
    }

    const userEmail = normEmail(info.metadata?.user_email);
    const planDays = Number(info.metadata?.plan_days || 30);
    const whatsapp = String(info.metadata?.whatsapp || "").trim();
    const pinHash = info.metadata?.pin_hash;

    if(!userEmail) return res.status(400).json({ ok:false, error:"Pagamento sem user_email." });

    const { data: current } = await supabase.from("bo_profiles").select("*").eq("email", userEmail).maybeSingle();

    const base = current?.expires_at && new Date(current.expires_at).getTime() > Date.now()
      ? new Date(current.expires_at)
      : new Date();

    const expiresAt = addDays(base, planDays);

    const payload = {
      email:userEmail,
      whatsapp: current?.whatsapp || whatsapp || "",
      role: current?.role || "user",
      status:"active",
      is_fixed_admin: current?.is_fixed_admin || false,
      is_lifetime: current?.is_lifetime || false,
      free_trial_granted: current?.free_trial_granted || false,
      plan_days:planDays,
      expires_at: current?.is_lifetime ? current.expires_at : expiresAt,
      last_payment_id:String(paymentId),
      updated_at:new Date().toISOString()
    };

    if(current?.pin_hash){
      payload.pin_hash = current.pin_hash;
    }else if(pinHash){
      payload.pin_hash = pinHash;
    }

    const { error } = await supabase.from("bo_profiles").upsert(payload, { onConflict:"email" });
    if(error) throw error;

    res.json({
      ok:true,
      message:"Acesso liberado/renovado.",
      email:userEmail,
      expires_at:expiresAt
    });
  }catch(error){
    console.error(error);
    res.status(500).json({ ok:false, error:"Erro no webhook: " + error.message });
  }
});

app.get("/admin/users", requireAdmin, async (req, res) => {
  const { data: users, error } = await supabase.from("bo_profiles").select("*").order("created_at", { ascending:false });
  if(error) return res.status(500).json({ ok:false, error:error.message });

  const now = Date.now();

  const stats = {
    total: users.length,
    admins: users.filter(u=>u.role==="admin").length,
    active: users.filter(u=>u.role==="admin" || u.is_lifetime || (u.status==="active" && u.expires_at && new Date(u.expires_at).getTime() > now)).length,
    expired: users.filter(u=>u.role!=="admin" && !u.is_lifetime && (!u.expires_at || new Date(u.expires_at).getTime() <= now)).length,
    blocked: users.filter(u=>u.status==="blocked").length,
    free_used: users.filter(u=>u.free_trial_granted && u.created_by !== "free_promo").length,
    free_remaining: Math.max(0, 100 - users.filter(u=>u.free_trial_granted && u.created_by !== "free_promo").length)
  };

  res.json({ ok:true, users, stats });
});

app.post("/admin/create-user", requireAdmin, async (req, res) => {
  try{
    const email = normEmail(req.body.email);
    const whatsapp = String(req.body.whatsapp || "").trim();
    const pin = String(req.body.pin || "").trim();
    const days = Number(req.body.days || 30);

    if(!email) return res.status(400).json({ ok:false, error:"Informe e-mail." });
    if(pin && !validPin(pin)) return res.status(400).json({ ok:false, error:"Senha precisa ter 4 números." });

    const { data: current } = await supabase.from("bo_profiles").select("*").eq("email", email).maybeSingle();

    const base = current?.expires_at && new Date(current.expires_at).getTime() > Date.now()
      ? new Date(current.expires_at)
      : new Date();

    const payload = {
      email,
      whatsapp: whatsapp || current?.whatsapp || "",
      role: current?.role || "user",
      status:"active",
      is_lifetime: current?.is_lifetime || false,
      plan_days:days,
      expires_at: current?.is_lifetime ? current.expires_at : addDays(base, days),
      created_by:req.profile.email,
      updated_at:new Date().toISOString()
    };

    if(pin) payload.pin_hash = hashPin(pin);

    const { data, error } = await supabase.from("bo_profiles").upsert(payload, { onConflict:"email" }).select("*").single();
    if(error) throw error;

    res.json({ ok:true, profile:data });
  }catch(error){
    res.status(500).json({ ok:false, error:error.message });
  }
});

app.post("/admin/add-admin", requireAdmin, async (req, res) => {
  try{
    const email = normEmail(req.body.email);
    const pin = String(req.body.pin || "").trim();

    if(!email) return res.status(400).json({ ok:false, error:"Informe e-mail." });
    if(!validPin(pin)) return res.status(400).json({ ok:false, error:"Senha admin precisa ter 4 números." });

    const isFixed = isFixedAdminEmail(email);

    const { data, error } = await supabase.from("bo_profiles").upsert({
      email,
      pin_hash:hashPin(pin),
      role:"admin",
      status:"active",
      is_fixed_admin:isFixed,
      is_lifetime:true,
      expires_at:"2099-12-31T23:59:59.000Z",
      created_by:req.profile.email,
      updated_at:new Date().toISOString()
    }, { onConflict:"email" }).select("*").single();

    if(error) throw error;

    res.json({ ok:true, profile:data });
  }catch(error){
    res.status(500).json({ ok:false, error:error.message });
  }
});

app.post("/admin/renew-user", requireAdmin, async (req, res) => {
  try{
    const email = normEmail(req.body.email);
    const days = Number(req.body.days || 30);
    const newPin = String(req.body.newPin || "").trim();

    const { data: current, error: findErr } = await supabase.from("bo_profiles").select("*").eq("email", email).single();
    if(findErr || !current) return res.status(404).json({ ok:false, error:"Usuário não encontrado." });

    const base = current.expires_at && new Date(current.expires_at).getTime() > Date.now()
      ? new Date(current.expires_at)
      : new Date();

    const payload = {
      status:"active",
      role: current.is_fixed_admin ? "admin" : current.role,
      is_lifetime: current.is_fixed_admin ? true : current.is_lifetime,
      plan_days:days,
      expires_at: current.is_fixed_admin || current.is_lifetime ? "2099-12-31T23:59:59.000Z" : addDays(base, days),
      updated_at:new Date().toISOString()
    };

    if(newPin){
      if(!validPin(newPin)) return res.status(400).json({ ok:false, error:"Nova senha precisa ter 4 números." });
      payload.pin_hash = hashPin(newPin);
    }

    const { data, error } = await supabase.from("bo_profiles").update(payload).eq("email", email).select("*").single();
    if(error) throw error;

    res.json({ ok:true, profile:data });
  }catch(error){
    res.status(500).json({ ok:false, error:error.message });
  }
});

app.post("/admin/block-user", requireAdmin, async (req, res) => {
  const email = normEmail(req.body.email);
  const { data: current } = await supabase.from("bo_profiles").select("*").eq("email", email).single();

  if(current?.is_fixed_admin || isFixedAdminEmail(email)){
    return res.status(400).json({ ok:false, error:"Não é permitido bloquear administrador fixo." });
  }

  const { data, error } = await supabase.from("bo_profiles").update({
    status:"blocked",
    updated_at:new Date().toISOString()
  }).eq("email", email).select("*").single();

  if(error) return res.status(500).json({ ok:false, error:error.message });

  res.json({ ok:true, profile:data });
});

app.post("/admin/unblock-user", requireAdmin, async (req, res) => {
  const email = normEmail(req.body.email);

  const { data, error } = await supabase.from("bo_profiles").update({
    status:"active",
    updated_at:new Date().toISOString()
  }).eq("email", email).select("*").single();

  if(error) return res.status(500).json({ ok:false, error:error.message });

  res.json({ ok:true, profile:data });
});

app.post("/admin/delete-user", requireAdmin, async (req, res) => {
  const email = normEmail(req.body.email);

  const { data: current } = await supabase.from("bo_profiles").select("*").eq("email", email).single();

  if(current?.is_fixed_admin || isFixedAdminEmail(email)){
    return res.status(400).json({ ok:false, error:"Não é permitido deletar administrador fixo." });
  }

  const { error } = await supabase.from("bo_profiles").delete().eq("email", email);

  if(error) return res.status(500).json({ ok:false, error:error.message });

  res.json({ ok:true });
});

app.get("/admin/plan-prices", requireAdmin, async (req, res) => {
  const { data, error } = await supabase.from("bo_plan_prices").select("*").order("plan_days", { ascending:true });
  if(error) return res.status(500).json({ ok:false, error:error.message });

  const now = Date.now();

  const plans = data.map(p => {
    const promoActive =
      p.promo_price_cents &&
      p.promo_starts_at &&
      p.promo_ends_at &&
      new Date(p.promo_starts_at).getTime() <= now &&
      new Date(p.promo_ends_at).getTime() >= now;

    return {
      ...p,
      normal_price: Number(p.normal_price_cents || 0) / 100,
      promo_price: p.promo_price_cents ? Number(p.promo_price_cents) / 100 : null,
      current_price: Number(promoActive ? p.promo_price_cents : p.normal_price_cents) / 100,
      promo_active: Boolean(promoActive)
    };
  });

  res.json({ ok:true, plans });
});

app.post("/admin/update-plan-price", requireAdmin, async (req, res) => {
  try{
    const planDays = Number(req.body.planDays);
    const normalPrice = Number(req.body.normalPrice);
    const normalPriceCents = Math.round(normalPrice * 100);

    if(![30,60,90].includes(planDays)) return res.status(400).json({ ok:false, error:"Plano inválido." });
    if(!normalPriceCents || normalPriceCents < 100) return res.status(400).json({ ok:false, error:"Preço mínimo R$1,00." });

    const { data, error } = await supabase.from("bo_plan_prices").upsert({
      plan_days: planDays,
      normal_price_cents: normalPriceCents,
      updated_at: new Date().toISOString()
    }, { onConflict:"plan_days" }).select("*").single();

    if(error) throw error;

    res.json({ ok:true, plan:data });
  }catch(error){
    res.status(500).json({ ok:false, error:error.message });
  }
});

app.post("/admin/start-promo", requireAdmin, async (req, res) => {
  try{
    const planDays = Number(req.body.planDays);
    const promoPrice = Number(req.body.promoPrice);
    const promoPriceCents = Math.round(promoPrice * 100);
    const hours = Number(req.body.hours || 24);

    if(![30,60,90].includes(planDays)) return res.status(400).json({ ok:false, error:"Plano inválido." });
    if(!promoPriceCents || promoPriceCents < 100) return res.status(400).json({ ok:false, error:"Promoção mínima R$1,00." });
    if(!hours || hours < 1) return res.status(400).json({ ok:false, error:"Duração mínima de 1 hora." });

    const startsAt = new Date();
    const endsAt = new Date(Date.now() + hours * 60 * 60 * 1000);

    const { data, error } = await supabase.from("bo_plan_prices").update({
      promo_price_cents: promoPriceCents,
      promo_starts_at: startsAt.toISOString(),
      promo_ends_at: endsAt.toISOString(),
      updated_at: new Date().toISOString()
    }).eq("plan_days", planDays).select("*").single();

    if(error) throw error;

    res.json({ ok:true, plan:data });
  }catch(error){
    res.status(500).json({ ok:false, error:error.message });
  }
});

app.post("/admin/stop-promo", requireAdmin, async (req, res) => {
  try{
    const planDays = Number(req.body.planDays);

    if(![30,60,90].includes(planDays)) return res.status(400).json({ ok:false, error:"Plano inválido." });

    const { data, error } = await supabase.from("bo_plan_prices").update({
      promo_price_cents: null,
      promo_starts_at: null,
      promo_ends_at: null,
      updated_at: new Date().toISOString()
    }).eq("plan_days", planDays).select("*").single();

    if(error) throw error;

    res.json({ ok:true, plan:data });
  }catch(error){
    res.status(500).json({ ok:false, error:error.message });
  }
});

app.get("/admin/free-promo", requireAdmin, async (req, res) => {
  const { data, error } = await supabase
    .from("bo_free_access_promos")
    .select("*")
    .order("created_at", { ascending:false })
    .limit(10);

  if(error) return res.status(500).json({ ok:false, error:error.message });

  res.json({ ok:true, promos:data });
});

app.post("/admin/start-free-promo", requireAdmin, async (req, res) => {
  try{
    const freeDays = Number(req.body.freeDays || 30);
    const extraSlots = Number(req.body.extraSlots || 10);
    const hours = Number(req.body.hours || 24);

    if(freeDays < 1) return res.status(400).json({ ok:false, error:"Dias grátis inválidos." });
    if(extraSlots < 1) return res.status(400).json({ ok:false, error:"Vagas grátis inválidas." });
    if(hours < 1) return res.status(400).json({ ok:false, error:"Duração mínima de 1 hora." });

    const startsAt = new Date();
    const endsAt = new Date(Date.now() + hours * 60 * 60 * 1000);

    const { data, error } = await supabase
      .from("bo_free_access_promos")
      .insert({
        enabled:true,
        free_days:freeDays,
        extra_slots:extraSlots,
        used_slots:0,
        starts_at:startsAt.toISOString(),
        ends_at:endsAt.toISOString(),
        updated_at:new Date().toISOString()
      })
      .select("*")
      .single();

    if(error) throw error;

    res.json({ ok:true, promo:data });
  }catch(error){
    res.status(500).json({ ok:false, error:error.message });
  }
});

app.post("/admin/stop-free-promo", requireAdmin, async (req, res) => {
  try{
    const promoId = req.body.promoId;

    let query = supabase
      .from("bo_free_access_promos")
      .update({
        enabled:false,
        updated_at:new Date().toISOString()
      });

    if(promoId){
      query = query.eq("id", promoId);
    }else{
      query = query.eq("enabled", true);
    }

    const { data, error } = await query.select("*");

    if(error) throw error;

    res.json({ ok:true, promos:data });
  }catch(error){
    res.status(500).json({ ok:false, error:error.message });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Biblioteca Obsidiana V2.4.3 online na porta ${port}`));
