# Personal Voice Assistant

A self-hosted personal phone assistant and email/calendar briefing system, built
entirely on **Google Apps Script + Vapi + Gemini**, with a privacy-by-design
architecture. It answers the calls you can't take in a cloned copy of your own
voice, books tentative appointments against your calendar, calls businesses on
your behalf, and sends you three email/calendar recaps a day.

> 🇮🇹 Versione italiana: [README.it.md](README.it.md)

> **Status:** working personal project, in production. The telephony layer is
> Italy-specific (see [Scope](#scope)).

## What it does

- **Inbound voice agent.** Calls you don't answer are forwarded to an AI agent
  that speaks in a clone of your voice. It identifies the caller, takes a
  message, or proposes appointment slots from your calendar.
- **Outbound calls.** From a web console, you describe a call to make ("book a
  table at restaurant X"); Gemini turns it into a call brief and the agent
  places the call for you, speaking in the first person.
- **Live monitoring.** While a call is in progress you get a push notification;
  tapping it opens a live transcript where you can feed the agent a line to say,
  send it a silent instruction, or hang up.
- **Three daily recaps.** At 06:00 / 14:00 / 21:00 the system classifies your
  important unread email, drafts replies to the standardizable ones, summarizes
  your agenda, and sends a detailed email plus a short push notification.
- **Contact whitelist.** Only callers in your Google Contacts reach the agent;
  unknown numbers get a polite "not available" and are hung up.

## Why this design

What makes this different from off-the-shelf "AI receptionist" products:

- **Privacy gateway.** The voice provider (Vapi) never gets direct access to
  your Google Calendar. Every calendar read/write goes through an Apps Script
  Web App that you own, which only ever exposes free/busy slots inside windows
  you define — never your actual events.
- **Deferred confirmation.** The agent never books anything as final. Every
  appointment is *tentative*; you confirm it personally afterwards.
- **Dual-channel notifications.** A short push ping for awareness, a full email
  (with transcript) for detail.
- **Transparent cost.** Around €13–18/month, all-in. No €99 "starter" tier.

## Architecture

```
                          ┌───────────────────────────┐
   Caller ──(missed)──▶   │  Your mobile operator     │
                          │  conditional call forward │
                          └────────────┬──────────────┘
                                       ▼
                          ┌───────────────────────────┐
                          │  Zadarma (SIP trunk, +39) │
                          └────────────┬──────────────┘
                                       ▼
   ┌──────────────────────────────────────────────────────────┐
   │  Vapi  — STT (Deepgram) · LLM (GPT-4o) · TTS (ElevenLabs)│
   └───────────────┬───────────────────────┬──────────────────┘
                   │ tool calls            │ webhooks (events)
                   ▼                       ▼
   ┌──────────────────────────────────────────────────────────┐
   │  Apps Script Web App  (the "gateway" — you own it)       │
   │  • check_availability / book_appointment  → Calendar     │
   │  • status-update / end-of-call   → Pushover + Gmail      │
   │  • live monitor (say / instruct / hangup)                │
   │  • outbound console + Gemini call-brief generator        │
   └──────────────────────────────────────────────────────────┘

   Recaps (independent): Apps Script time triggers → Gemini → Gmail + Pushover
```

The voice provider only ever talks to *your* gateway. The gateway holds the
logic and the boundaries.

## Components

All code lives in [`apps-script/`](apps-script/) — one Apps Script project:

| File | Role |
|------|------|
| `Config.gs` | Centralized non-secret configuration + a `secret()` helper that reads secrets from Script Properties. |
| `Vapi.gs` | The gateway: 3-tier auth router, calendar tools, call webhooks, live monitor, outbound calls, Gemini call-brief endpoint. |
| `Recap.gs` | The three daily email/calendar recaps. Email classification and reply drafting via Gemini. `sendPush` (Pushover) lives here, shared with `Vapi.gs`. |
| `WhitelistSync.gs` | Nightly sync of Google Contacts into a local whitelist. |
| `LiveCall.html` | Live call monitoring page (served by the gateway). |
| `OutboundConsole.html` | Web console to compose and launch outbound calls. |

## Authentication model

One Apps Script deployment, access "Anyone". Auth is enforced **in the router**,
per action type:

- **Machine actions** (Vapi webhooks/tools) → a master token, stored in Script
  Properties. Vapi is a server and cannot do a Google login.
- **Page actions** (`live_view`, `outbound_console`) → `Session.getActiveUser()`
  must equal the owner's email. On an "Anyone" deployment this returns the
  owner's email to the owner and an empty string to everyone else.
- **AJAX actions** (the pages' internal fetches) → a short-lived token, minted
  server-side when a page loads (CacheService, 2h TTL). The master token never
  reaches the browser.

## Cost

Roughly **€13–18/month** for personal use (~30 calls/month of ~2 min each),
plus a one-time **$5** for the Pushover app license:

| Item | Cost |
|------|------|
| Vapi platform | ~$3/mo |
| ElevenLabs (Starter, voice clone + TTS) | $5/mo |
| LLM (GPT-4o) | ~$2/mo |
| Deepgram STT | included in Vapi credit |
| Zadarma Italian DID | ~$4/mo (billed yearly) |
| Gemini API (recaps) | free tier |
| Pushover | $5 one-time, then free (10k msg/month) |

## Prerequisites

Accounts: Google (Apps Script, Calendar, Gmail, Contacts), [Vapi](https://vapi.ai),
[ElevenLabs](https://elevenlabs.io), [Zadarma](https://zadarma.com),
[Gemini API key](https://aistudio.google.com/apikey), and
[Pushover](https://pushover.net).

## Setup

This is **not** a five-minute setup — budget a couple of hours and read
carefully. Full step-by-step: **[docs/en/setup.md](docs/en/setup.md)**.

## Configuration

No secrets are committed to this repo.

- **Non-secret config** lives in `Config.gs` as plain constants: owner email,
  calendar id, the Vapi/ElevenLabs IDs, the deployment URL, the availability
  windows. Search for `REPLACE_WITH_...` and `youremail@example.com` and fill
  them in.
- **Secrets** live in **Script Properties** (Apps Script → Project Settings →
  Script Properties), never in code: `VAPI_GATEWAY_TOKEN`, `VAPI_PRIVATE_KEY`,
  `GEMINI_API_KEY`, `PUSHOVER_TOKEN`, `PUSHOVER_USER`.

The code also uses **"Andrea Braschi"** as the example owner name in a few
prompts — search-and-replace it with your own.

## Deployment

Use **one** deployment, and always update it **in place**: Apps Script →
Deploy → Manage deployments → edit → *New version*. The `/exec` URL stays
stable. Never use "New deployment" — it mints a fresh URL and the URL inside
`Config.gs` will no longer match the running deployment.

## Security notes

- Keep every secret **only** inside Script Properties — never in the repo.
- The master gateway token is used only by Vapi's machine calls and never
  reaches the browser; the pages are gated by your Google identity; their AJAX
  uses a short-lived token.
- Recording is disabled by default (transcript only). If you enable call
  recording, in many countries you must announce it to the caller.
- Cloning your own voice is fine; cloning someone else's without consent is not.

## Scope

The telephony layer is **Italy-specific**: it assumes a Zadarma Italian DID
(+39), Italian GSM call-forwarding codes, and Italian number normalization. The
recap and gateway logic is country-agnostic; the phone parts would need
adapting for other countries.

## License

[MIT](LICENSE) — © 2026 Andrea Braschi.
