# WhatsApp Price Bot (Dualhook coexistence + Google Sheet)

Customer sends "17 pro max" → bot replies with today's price from a Google Sheet.
The shop keeps using the WhatsApp Business app on the same number.

## Order matters
Deploy the bot on Render FIRST. Dualhook asks for the webhook URL and verify
token BEFORE Meta's signup starts.

## 1. Google Sheet
Tab **Prices**, row 1: `Model | Price | Updated | Keywords`.
Share: Anyone with link → Viewer. Add owner's Gmail as Editor. Copy ID (between /d/ and /edit).

## 2. GitHub
Private repo with: index.js, package.json, render.yaml, README.md.

## 3. Render (Blueprint)
Render → New → Blueprint → connect the repo → Render reads render.yaml.
It asks for SHOP_NAME and VERIFY_TOKEN (fill now). PHONE_NUMBER_ID and
DUALHOOK_KEY: leave empty now, add them after Dualhook step 5
(Service → Environment → edit → Save Changes).
PROVIDER, SHEET_ID and SHEET_TAB are pre-filled.
Open the URL → "Price bot running ✅".

## 4. UptimeRobot
HTTP(s) monitor on the Render URL every 5 minutes.

## 5. Dualhook (with the shop owner's phone)
1. Sign up at dualhook.com (free trial), choose the 1-connection plan.
2. New connection → enter webhook URL `https://<app>.onrender.com/webhook`
   and the same VERIFY_TOKEN as Render.
3. Start Embedded Signup → owner logs in with Facebook → pick/create business
   portfolio → choose the number already in the WhatsApp Business app →
   approve on the phone → allow chat history sharing.
4. Connection → Overview: copy the Phone number ID, and create the
   Outbound API key (dh_live_..., shown once).
5. Add PHONE_NUMBER_ID and DUALHOOK_KEY on Render → it restarts.

## 6. Test
Other phone sends `17 pro max` → price. `price list` → all prices.
Turn off greeting/away messages in the Business app.

## Rules to remember
- Owner must open/use the WhatsApp Business app at least every ~13 days
  (Meta heartbeat) or coexistence disconnects. Dualhook emails a warning.
- If the Dualhook subscription lapses, replies stop (app keeps working).

## Troubleshooting (Render → Logs)
- Webhook verify fails in Dualhook → VERIFY_TOKEN mismatch or Render asleep.
- "Send failed 401" → DUALHOOK_KEY wrong/rotated.
- "Send failed 403 connection_not_routable" → fix connection/billing in Dualhook.
- "Sheet fetch failed" → sheet sharing or tab name.
