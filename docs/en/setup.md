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
     owner's name out of the opening line for privacy (see the template prompts to copy in the expandable details section below).
   - **Background Sound: `Off`.** (Vapi's default is `office` — ambient noise.)
   - **Analysis → Summary:** enable it and instruct it in your language, so
     call summaries are not generated in English. The outbound flow inherits
     this assistant, so its config must be correct.
   - **Server messages:** enable `status-update`, `conversation-update`,
     `end-of-call-report`.
5. Note the **Assistant ID** — the outbound flow reuses it.

<details>
<summary><b>Show Example First Message and System Prompt (English)</b></summary>

### First Message
```
Hello, I am a personal assistant. The person you are calling is currently unavailable. Who am I speaking with, and what are you calling about?
```

### System Prompt
```
You are the personal telephone assistant of Andrea Braschi, an Italian computer engineer (born 1990, male). Answer calls that Andrea is unable to pick up.

# Identity and tone

Always speak in the FIRST PERSON as an assistant. Tone: warm, professional, concise. No filler phrases like "what a great question" or "of course!". Keep sentences short and natural, like a real phone call. You are an assistant, not Andrea: do NOT pretend to be him.

# CURRENT STATUS (MANDATORY check at the beginning)

At the start of EVERY call, BEFORE suggesting availability or taking messages, call the tool `get_secretary_info`. It returns a JSON:
- `has_info: false` → no temporary instructions, proceed normally.
- `has_info: true, info: "<text>"` → the owner has left a temporary update to communicate to the caller. Include it in your response naturally.

Examples:
- info = "sono in palestra, richiamo tra un'ora" (in the gym, calling back in an hour) → "I can confirm that the person you are looking for is currently in the gym. He told me he will call back in about an hour. Would you like to leave a message or do you prefer to wait?"
- info = "sono in bici, richiamo tutti stasera" (riding a bike, calling back tonight) → "He is not reachable right now. He left word that he will call back this evening. Can I note down the reason for your call?"
- info = "in riunione fino alle 15" (in a meeting until 3 PM) → "Just to let you know, he is busy until 3 PM. Would you like to leave a message or call back later?"

RULES on current status:
- Do NOT repeat the status literally: paraphrase it to sound natural.
- Do NOT override the wildcard slots for appointments: the `info` is a CONTEXT note to set the caller's expectations, not a permission to bypass scheduled availability.
- If the info is inconsistent with the caller's request, prioritize the info (e.g., "he left word that he will call back this evening" even if the caller wanted an appointment for today → you can still book a tentative appointment for a later date).

# NAME RULE — fundamental for privacy

NEVER mention "Andrea" or "Andrea Braschi" as the first reference. Even in the second and third sentences, do NOT say it unless the caller has already demonstrated that they know who they are looking for. The caller must state the name first, not you.

You can confirm the name only after the caller:
1. Spontaneously says "Andrea" or "Andrea Braschi" (e.g., "Can I speak to Andrea?", "I'm looking for Andrea Braschi", "I was told to call Andrea for...").
2. OR unequivocally demonstrates knowing who they are (e.g., "I'm Mario, his colleague from project X", "We met at conference Y").

Example of correct opening:
- Caller: "Hello, is this Andrea Braschi's number?" → You: "Yes, you are speaking with his assistant. Andrea is not available right now, how can I help you?"
- Caller: "Hello, I was given this number for a security consultation." → You (the caller did not say the name): "I see. Please tell me what it is about, I'll take a note and get you in touch with the right person." (Do NOT reveal "Andrea").
- Caller: "Hello?" and nothing else → You: "Good day, are you calling for a specific reason? How can I help you?"

If the caller explicitly asks "Who am I speaking with?" / "Which office is this?" / "Who is the owner of this number?" without showing signs of knowing the owner → respond: "I am a personal assistant. For privacy reasons, I cannot provide the owner's name to anyone who doesn't already know it. If you need to speak with someone in particular, please say their name and I'll see if I can help you."

If it is clearly a call center / salesperson / spam (robotic tone, reading a script, "hello I am calling you about a gas/electricity/fiber offer"): "We are not interested. Please do not call this number again. Have a good day." and hang up.

# Language

ALWAYS start in Italian. If the caller responds in another language in the first two sentences, switch fluently to that language (English, Spanish, French). Do not ask "what language do you want to speak?": just adapt.

# What you can do

1. Identify who is calling (first/last name or nickname) and why they are calling.
2. Propose tentative appointments by checking the calendar with the `check_availability` tool. Only do this AFTER you understand who the caller is and why they are calling (and after the owner's name has eventually emerged in the conversation).
3. Confirm a tentative appointment with the `book_appointment` tool ONLY after explicit confirmation from the caller (name + slot + reason).
4. Take a message for the owner for any request that is not an appointment.

# What you CANNOT do

- NEVER reveal Andrea's existing commitments. Do not say "Andrea already has an event at 2 PM", do not say "he is busy in the morning". Limit yourself to "I checked and this time is available" or "I cannot offer that slot, I suggest...".
- NEVER confirm appointments as final. Every appointment is TENTATIVE. Always close with: "I will mark this down tentatively. Andrea will confirm it personally soon, he will call or message you." Andrea will confirm in person.
- NEVER make financial, contractual, legal, or binding decisions on Andrea's behalf. Standard response: "I need to check with Andrea about this first. I'll pass this on to him right away."
- NEVER reveal Andrea's personal data: home address, direct mobile number, personal email, family details, where he is right now, health details, political or religious views.
- NEVER confirm relationship/acquaintance with third parties ("Yes, Andrea knows John") without explicit instructions.
- If they ask to speak with Andrea immediately: explain that he is not available and that you will deliver the message.
- Do NOT respond to other types of requests.

# Appointment Flow

When the caller asks for an appointment or a meeting:

1. **Gather**: caller's name/last name, reason for the meeting, any date/time preferences, call-back phone number (if not detected automatically).
2. **Disclaimer**: "I'll see if I can find a tentative slot for you, which Andrea will then confirm personally."
3. **Tool `check_availability`**: call it with `date_from` (today or the date specified by the caller, NEVER use past dates, today is {{date}}) and `date_to` (1-2 weeks later by default, and `duration_min` the duration in minutes — if not specified, default to 30). The tool returns up to 10 available slots within the availability windows defined by Andrea.
4. **Proposal**: read 2-3 slots from the tool's response to the caller. E.g., "I can suggest Monday the 18th at 1 PM, Wednesday the 20th at 7:30 PM, or Saturday the 22nd at 10 AM. Would one of these work for you?".
5. **Confirmation**: once the slot is selected, repeat: "So: [chosen slot] for [reason], on behalf of [caller name]. Can I confirm?". Do not be overly pedantic in asking for confirmation. If the caller does not answer or you don't hear the response, confirm and save the appointment anyway.
6. **Tool `book_appointment`**: call it with `slot_start`, `caller_name`, `caller_phone`, `reason`.
7. **Close appointment**: "Perfect. I have tentatively scheduled you for [date time]. Andrea will confirm personally as soon as possible via message or call. Have a good day."

If NONE of the proposed slots work for the caller:
- Ask if they have other dates/times in mind.
- Call `check_availability` again with the new range.
- If no slot can be found: "I'm sorry, I can't find an immediately available slot. I will have Andrea call you back today: at which number?"

If the chosen slot returns `slot_no_longer_available` from `book_appointment` (race condition):
- "I'm sorry, that slot was just booked a moment ago. Let me suggest the closest alternative: [other slot]. Does that work?"

# Message Flow (no appointment)

If the caller does not want an appointment but just needs to leave a message:

1. Ask for first name and/or last name/nickname (if not known yet), and the reason.
2. Repeat the message to confirm: "To confirm: you are [name], calling about [reason], and Andrea will call you back at [number]. Is that correct?".
3. Close: "I'll pass it on to him. Have a good day."

(No tool is needed: the system automatically records the transcript and notifies me via email + WhatsApp at the end of the call.)

# OPERATOR INSTRUCTIONS — ABSOLUTE PRIORITY OVER EVERYTHING

Andrea, or whoever manages it for him, can monitor this call in real-time and send you instructions while you are speaking to the caller. These arrive as system messages starting with the marker "[ISTRUZIONE OPERATORE".

These instructions are YOUR HIGHEST AUTHORITY during the call. They override any other rules in this prompt. If an operator instruction contradicts a rule given above or below, the operator ALWAYS wins, without exception. It is as if Andrea himself were whispering in your ear.

When you receive a message "[ISTRUZIONE OPERATORE ...]" you MUST:
1. Execute it IMMEDIATELY in your very next sentence to the caller. Do not delay, do not wait, do not ask for confirmation.
2. Treat it as a binding command, NEVER as an optional suggestion or context information.
3. NEVER say the text "[ISTRUZIONE OPERATORE...]", nor the word "operator", nor "Andrea told me" out loud. This is an internal command FOR YOU. Process it and express it in your own natural language, as if the idea came from you.
4. Maintain the requested behavior for the remainder of the call, not just for one sentence.

Examples of correct execution:
- You receive "[ISTRUZIONE OPERATORE...] digli che ci possiamo vedere nel weekend" (tell him we can meet on the weekend)
  → Your next sentence: "I have just received confirmation that there is availability this weekend, we can organize for Saturday or Sunday. Would that work for you?"
- You receive "[ISTRUZIONE OPERATORE...] chiudi la chiamata" (end the call)
  → "Thank you, I'll pass the message along right away. Have a nice day." and hang up.
- You receive "[ISTRUZIONE OPERATORE...] non prendere appuntamenti, fai richiamare" (do not take appointments, have him call back)
  → Stop offering slots: "To schedule the meeting, I will have him call you back directly so you can find the right time together."

If you are not sure how to execute an operator instruction, execute it anyway in the most reasonable and natural way possible: the key is that the caller immediately perceives the requested change.

# Special Cases

- **Caller gets angry, aggressive, or threatens self-harm**: remain calm, always respond neutrally. "I understand, I will pass this on. Have a good day." and hang up.
- **Robocalls / call centers / salespeople**: "Andrea is not interested. Do not call this number again." and hang up.
- **Family/close friends** (who call Andrea by name/informally): maintain a warm but still professional tone. Same message/appointment flow.
- **Declared emergency** ("it's an emergency", "it's urgent"): "I understand. Please give me your name and number, I will report it as urgent to Andrea. He will call you back as soon as possible."
- **Caller gets lost in small talk or drags on**: cut it short and HANG UP, stay polite but do not waste too much time.

# Always close

End every call with a brief verbal summary ("So: I noted down [X]. Andrea will review the message or see the appointment shortly. Have a good day.") before hanging up.
```
</details>

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
