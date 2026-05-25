# Setup guide

End-to-end setup of the personal voice assistant. Budget ~2 hours the first
time. Read each step fully before doing it.

## Order of operations

1. Voice clone (ElevenLabs)
2. Vapi account + inbound assistant
3. Pushover (push notifications)
4. Apps Script project + configuration
5. Deploy the Web App
6. Daily recaps
7. Italian phone number (Zadarma) + SIP trunk
8. Call forwarding
9. Contact whitelist
10. Test

---

## 1. Voice clone (ElevenLabs)

1. Create an [ElevenLabs](https://elevenlabs.io) account. The Starter plan ($5/mo)
   is enough.
2. **Voices → Add a new voice → Instant Voice Cloning.** Upload 1–2 minutes of
   clean audio of your voice (no background noise, natural tone).
3. Open the voice and note the **Voice ID**.
4. **Profile → API Keys → Create API Key.** Copy it.

## 2. Vapi account + inbound assistant

1. Create a [Vapi](https://dashboard.vapi.ai) account.
2. **Providers → TTS → ElevenLabs:** paste the ElevenLabs API key.
3. **API Keys:** copy the **Private** key (server-side, not the public one).
4. **Assistants → Create Assistant.** Configure:
   - **Model:** OpenAI `gpt-4o`, temperature `0.3`.
   - **Voice:** ElevenLabs, your cloned Voice ID, model `eleven_turbo_v2_5`.
   - **Transcriber:** Deepgram `nova-2`, language `it` (fixed — not `multi`).
   - **First message / system prompt:** the receptionist behavior. Keep the
     owner's name out of the opening line for privacy.
   - **Background Sound: `Off`.** (Vapi's default is `office` — ambient noise.)
   - **Analysis → Summary:** enable it and instruct it in your language, so
     call summaries are not generated in English. The outbound flow inherits
     this assistant, so its config must be correct.
   - **Server messages:** enable `status-update`, `conversation-update`,
     `end-of-call-report`.
5. Note the **Assistant ID** — the outbound flow reuses it.

## 3. Pushover (push notifications)

1. Create a [Pushover](https://pushover.net) account; note the **User Key**.
2. Create an **Application/API Token** (Pushover dashboard → Create an
   Application) and copy the **API Token**.
3. Install the Pushover app on your phone (one-time $5 license after a 30-day
   trial).

## 4. Apps Script project + configuration

1. Go to [script.google.com](https://script.google.com) → new project.
2. Create the files and paste the contents of [`apps-script/`](../../apps-script/):
   `Config.gs`, `Vapi.gs`, `Recap.gs`, `WhitelistSync.gs`, and the two HTML
   files (`LiveCall`, `OutboundConsole` — add them as HTML files).
3. In `Config.gs`, fill the non-secret constants: `OWNER_EMAIL`, the Vapi/
   ElevenLabs IDs, `CARTABIANCA_WINDOWS`. Leave `WEBAPP_API_URL`/`WEBAPP_UI_URL`
   for after the deploy (step 5).
4. **Secrets → Project Settings → Script Properties.** Add five keys (never in
   code): `VAPI_GATEWAY_TOKEN` (generate with `openssl rand -hex 32`),
   `VAPI_PRIVATE_KEY`, `GEMINI_API_KEY`, `PUSHOVER_TOKEN`, `PUSHOVER_USER`.
5. Enable the **People API** advanced service (for `WhitelistSync.gs`).

The router enforces a 3-tier auth: Vapi's machine calls use the gateway token;
the pages (`live_view`, `outbound_console`) require the owner's Google identity;
the pages' AJAX uses a short-lived token. You don't configure this — it's in the
code — but it's why the setup below uses a single "Anyone" deployment.

## 5. Deploy the Web App

1. **Deploy → New deployment → Web app.** Execute as *you*; access **Anyone**.
2. Copy the `/exec` URL. Put it in `Config.gs` as both `WEBAPP_API_URL` and
   `WEBAPP_UI_URL` (`WEBAPP_UI_URL = WEBAPP_API_URL`).
3. **Update the deployment** so it runs the code with the URL filled in:
   Deploy → Manage deployments → edit (pencil) → Version: *New version*.
4. In the Vapi assistant set **Server URL** to
   `<WEBAPP_URL>?token=<VAPI_GATEWAY_TOKEN>&action=vapi_event`, and create three
   **tools** (`check_availability`, `book_appointment`, `get_secretary_info`)
   pointing at the same URL with the same token.

> **Golden rule:** use one deployment and always update it **in place**
> (Manage deployments → pencil → New version). The `/exec` URL stays stable.
> "New deployment" mints a fresh URL and breaks the match with `Config.gs`.

## 6. Daily recaps

Create three time-based triggers for `runMorningRecap`, `runAfternoonRecap`,
`runEveningRecap`. Set the project time zone (Project Settings) to your zone.
The recaps use the Gemini key and Pushover credentials already in Script
Properties.

## 7. Italian phone number (Zadarma) + SIP trunk

Vapi does not sell Italian numbers. Use a Zadarma DID + a BYO SIP trunk.

**Critical:** the integration uses a **PBX extension**, not the basic SIP
account from `my.zadarma.com/mysip/`. The basic SIP account requires an active
SIP registration to place outbound calls; the Vapi trunk does not register, so
outbound calls fail with `407 proxy-authentication-required`.

1. Open a Zadarma account, top up, order an Italian DID (requires proof of
   identity and address).
2. Go to **My PBX** (`my.zadarma.com/mypbx/`). Note the extension `100`: server
   `pbx.zadarma.com`, login `NUMBER-100`, and the SIP password.
3. Assign the DID to the PBX.
4. Create the Vapi BYO SIP trunk credential:

   ```bash
   curl -s -X POST 'https://api.vapi.ai/credential' \
     -H 'Authorization: Bearer YOUR_VAPI_PRIVATE_KEY' \
     -H 'Content-Type: application/json' \
     -d '{
       "provider": "byo-sip-trunk",
       "name": "Zadarma PBX Trunk",
       "gateways": [
         { "ip": "pbx.zadarma.com", "inboundEnabled": false, "outboundEnabled": true }
       ],
       "outboundLeadingPlusEnabled": true,
       "outboundAuthenticationPlan": {
         "authUsername": "NUMBER-100",
         "authPassword": "EXTENSION_PASSWORD"
       }
     }'
   ```

   Do **not** add a `sipRegisterPlan` — it causes the 407. If a credential has
   been patched repeatedly and still 407s, delete it and recreate it fresh.
5. Create the Vapi `byo-phone-number` resource with the DID and the
   `credentialId` from step 4.
6. On the Zadarma PBX extension, set call forwarding to the SIP URI
   `+39YOURNUMBER@sip.vapi.ai` (the inbound path).

## 8. Call forwarding

On your mobile, conditional call forwarding to the Zadarma number via GSM codes
(Italian operators):

- On no answer (after 20s): `**61*+39YOURNUMBER*11*20#`
- On busy/rejected: `**67*+39YOURNUMBER#`
- Disable all: `##002#`

Do **not** use unconditional forwarding.

## 9. Contact whitelist

Run `syncContactsToWhitelist` once (`WhitelistSync.gs`), then add a daily
trigger (e.g. 03:00). Only callers in your Google Contacts reach the agent.

## 10. Test

- `testPush` (editor) → a Pushover notification.
- `testRunMorningRecap` (editor) → a recap email + push.
- Call your number from another phone, don't answer → the agent picks up.
- `testOutboundCall` (editor) → an outbound test call.
- Open `<WEBAPP_URL>?action=outbound_console` logged into Google → the console
  loads (and shows "Access denied" if you're not the owner).

---

## Known issues

### SIP `407 proxy-authentication-required`

See step 7: use a PBX extension (not the basic SIP account), `pbx.zadarma.com`,
no `sipRegisterPlan`, and recreate the credential fresh if it has been patched
many times.

### Call summary in the wrong language

The outbound flow inherits the inbound assistant's configuration via
`assistantId` + `assistantOverrides`. Make sure the inbound assistant's Analysis
/ Summary is configured in your language — outbound calls mirror it.

### Push provider

This project uses Pushover, not ntfy.sh. The public ntfy.sh instance is not
reliably reachable from Google's Apps Script network (hostname timeouts) and its
free tier has a daily message quota; Pushover's `api.pushover.net` is reachable
directly and has generous limits.
