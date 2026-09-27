// WhatsApp Price Bot — replies with today's price from a Google Sheet
// Node 18+ (uses built-in fetch)

require("dotenv").config();
const express = require("express");
const crypto = require("crypto");

const {
  PROVIDER = "dualhook", // "dualhook" (coexistence), "360dialog", or "meta" (direct Cloud API)
  DUALHOOK_KEY,        // Dualhook: dh_live_... key from Connection → Overview → Outbound API key
  D360_API_KEY,        // 360dialog: API key for your number
  WEBHOOK_SECRET,      // 360dialog: any long random string
  WEBHOOK_URL,         // 360dialog: https://your-app.onrender.com/webhook
  VERIFY_TOKEN,        // any secret string you choose; also entered in Meta dashboard
  WHATSAPP_TOKEN,      // permanent System User access token
  PHONE_NUMBER_ID,     // from WhatsApp > API Setup
  APP_SECRET,          // from App Settings > Basic (used to verify requests)
  SHEET_ID,            // the long ID in your Google Sheet URL
  SHEET_TAB = "Prices",
  SHOP_NAME = "Our Store",
  PORT = 3000,
} = process.env;

const GRAPH = "https://graph.facebook.com/v25.0";
const DUALHOOK = "https://api.dualhook.com/v25.0";
const CACHE_MS = 5 * 60 * 1000; // re-read the sheet at most every 5 minutes

const app = express();
app.use(express.json({ verify: (req, _res, buf) => (req.rawBody = buf) }));

// ---------- Google Sheet ----------
let cache = { rows: [], at: 0 };

function parseCSV(text) {
  const rows = [];
  let row = [], field = "", inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c !== "\r") field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// Lowercase, drop brand words and everything that isn't a letter/digit
const normalize = (s) =>
  String(s || "").toLowerCase().replace(/iphone|apple/g, "").replace(/[^a-z0-9]/g, "");

async function getPrices() {
  if (Date.now() - cache.at < CACHE_MS && cache.rows.length) return cache.rows;

  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(SHEET_TAB)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Sheet fetch failed: ${res.status}`);

  const [header, ...data] = parseCSV(await res.text());
  const col = (name) => header.findIndex((h) => h.trim().toLowerCase() === name);
  const iModel = col("model"), iPrice = col("price"), iUpdated = col("updated"), iKeys = col("keywords");

  const rows = data
    .filter((r) => r[iModel] && r[iPrice])
    .map((r) => {
      const aliases = iKeys >= 0 ? (r[iKeys] || "").split(";") : [];
      return {
        model: r[iModel].trim(),
        price: r[iPrice].trim(),
        updated: iUpdated >= 0 ? (r[iUpdated] || "").trim() : "",
        modelKey: normalize(r[iModel]),
        keys: [r[iModel], ...aliases].map(normalize).filter((k) => k.length >= 2),
      };
    });

  cache = { rows, at: Date.now() };
  return rows;
}

// Pick the row whose keyword is the longest one found in the message,
// so "17 pro max" beats "17 pro" and "17". On a tie, a real model name
// beats a keyword (so a "16+" keyword can't steal "iPhone 16").
function findModel(rows, text) {
  const msg = normalize(text);
  let best = null, bestScore = 0;
  for (const row of rows) {
    for (const k of row.keys) {
      if (!msg.includes(k)) continue;
      const score = k.length * 2 + (k === row.modelKey ? 1 : 0);
      if (score > bestScore) { best = row; bestScore = score; }
    }
  }
  return best;
}

// ---------- WhatsApp ----------
async function sendText(to, body) {
  let url, auth;
  if (PROVIDER === "dualhook") {
    url = `${DUALHOOK}/${PHONE_NUMBER_ID}/messages`;
    auth = { Authorization: `Bearer ${DUALHOOK_KEY}` };
  } else if (PROVIDER === "360dialog") {
    url = "https://waba-v2.360dialog.io/messages";
    auth = { "D360-API-KEY": D360_API_KEY };
  } else {
    url = `${GRAPH}/${PHONE_NUMBER_ID}/messages`;
    auth = { Authorization: `Bearer ${WHATSAPP_TOKEN}` };
  }
  const res = await fetch(url, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body } }),
  });
  if (!res.ok) console.error("Send failed:", res.status, await res.text());
}

function validSignature(req) {
  if (PROVIDER === "dualhook") return true; // Meta signs with Dualhook's app secret, not ours
  if (PROVIDER === "360dialog") return !WEBHOOK_SECRET || req.get("x-bot-secret") === WEBHOOK_SECRET;
  if (!APP_SECRET) return true; // skip check if not configured
  const sig = req.get("x-hub-signature-256") || "";
  const expected = "sha256=" + crypto.createHmac("sha256", APP_SECRET).update(req.rawBody).digest("hex");
  return sig.length === expected.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}

const seen = new Set(); // Meta sometimes delivers the same message twice

async function handleMessage(msg) {
  if (msg.type !== "text" || seen.has(msg.id)) return;
  seen.add(msg.id);
  if (seen.size > 1000) seen.clear();

  const text = msg.text.body;
  const rows = await getPrices();

  // "price list" / "prices" → send the full list
  if (/price\s*list|all\s*prices|^prices?$/i.test(text.trim())) {
    const list = rows.map((r) => `• ${r.model}: ${r.price}`).join("\n");
    return sendText(msg.from, `📱 *${SHOP_NAME} – Today's Prices*\n\n${list}`);
  }

  const row = findModel(rows, text);
  if (!row) return; // no match → stay silent so you can reply personally

  const date = row.updated ? ` (updated ${row.updated})` : "";
  await sendText(
    msg.from,
    `📱 *${row.model}*\n💰 Today's price: *${row.price}*${date}\n\nReply "price list" to see all models.`
  );
}

// Meta calls this once to verify your webhook
app.get("/webhook", (req, res) => {
  const { "hub.mode": mode, "hub.verify_token": token, "hub.challenge": challenge } = req.query;
  if (mode === "subscribe" && token === VERIFY_TOKEN) return res.status(200).send(challenge);
  res.sendStatus(403);
});

// Incoming messages
app.post("/webhook", (req, res) => {
  if (!validSignature(req)) return res.sendStatus(401);
  res.sendStatus(200); // acknowledge immediately; Meta retries if slow

  const messages = req.body?.entry?.flatMap((e) => e.changes?.flatMap((c) => c.value?.messages || []) || []) || [];
  messages.forEach((m) => handleMessage(m).catch((err) => console.error("Handle error:", err)));
});

app.get("/", (_req, res) => res.send("Price bot running ✅"));

// 360dialog: register our webhook automatically on every start (no terminal needed)
async function registerWebhook() {
  if (PROVIDER !== "360dialog" || !D360_API_KEY || !WEBHOOK_URL) return;
  try {
    const res = await fetch("https://waba-v2.360dialog.io/v1/configs/webhook", {
      method: "POST",
      headers: { "D360-API-KEY": D360_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ url: WEBHOOK_URL, headers: WEBHOOK_SECRET ? { "x-bot-secret": WEBHOOK_SECRET } : {} }),
    });
    console.log("Webhook registration:", res.status, await res.text());
  } catch (err) {
    console.error("Webhook registration failed:", err);
  }
}

app.listen(PORT, () => {
  console.log(`Listening on ${PORT}`);
  registerWebhook();
});
