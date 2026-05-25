# Guida al setup

Setup end-to-end dell'assistente vocale personale. Metti in conto ~2 ore la
prima volta. Leggi ogni passo per intero prima di eseguirlo.

## Ordine delle operazioni

1. Voice clone (ElevenLabs)
2. Account Vapi + assistente inbound
3. Pushover (notifiche push)
4. Progetto Apps Script + configurazione
5. Deploy del Web App
6. Recap giornalieri
7. Numero italiano (Zadarma) + SIP trunk
8. Inoltro chiamate
9. Whitelist contatti
10. Test

---

## 1. Voice clone (ElevenLabs)

1. Crea un account [ElevenLabs](https://elevenlabs.io). Il piano Starter ($5/mese)
   è sufficiente.
2. **Voices → Add a new voice → Instant Voice Cloning.** Carica 1–2 minuti di
   audio pulito della tua voce (niente rumore di fondo, tono naturale).
3. Apri il voice e annota il **Voice ID**.
4. **Profile → API Keys → Create API Key.** Copiala.

## 2. Account Vapi + assistente inbound

1. Crea un account [Vapi](https://dashboard.vapi.ai).
2. **Providers → TTS → ElevenLabs:** incolla l'API key di ElevenLabs.
3. **API Keys:** copia la chiave **Private** (server-side, non la public).
4. **Assistants → Create Assistant.** Configura:
   - **Model:** OpenAI `gpt-4o`, temperature `0.3`.
   - **Voice:** ElevenLabs, il tuo Voice ID clonato, model `eleven_turbo_v2_5`.
   - **Transcriber:** Deepgram `nova-2`, lingua `it` (fissa — non `multi`).
   - **First message / system prompt:** il comportamento da segretario. Tieni il
     nome del titolare fuori dalla frase d'apertura, per privacy.
   - **Background Sound: `Off`.** (Il default di Vapi è `office` — rumore
     ambientale.)
   - **Analysis → Summary:** abilitalo e istruiscilo in italiano, così i
     riassunti non vengono generati in inglese. Il flusso outbound eredita
     questo assistente, quindi la sua config dev'essere corretta.
   - **Server messages:** abilita `status-update`, `conversation-update`,
     `end-of-call-report`.
5. Annota l'**Assistant ID** — il flusso outbound lo riusa.

## 3. Pushover (notifiche push)

1. Crea un account [Pushover](https://pushover.net); annota la **User Key**.
2. Crea un'**Application/API Token** (dashboard Pushover → Create an
   Application) e copia l'**API Token**.
3. Installa l'app Pushover sul telefono (licenza una tantum da $5 dopo 30
   giorni di prova).

## 4. Progetto Apps Script + configurazione

1. Vai su [script.google.com](https://script.google.com) → nuovo progetto.
2. Crea i file e incolla i contenuti di [`apps-script/`](../../apps-script/):
   `Config.gs`, `Vapi.gs`, `Recap.gs`, `WhitelistSync.gs`, e i due file HTML
   (`LiveCall`, `OutboundConsole` — aggiungili come file HTML).
3. In `Config.gs` compila le costanti non segrete: `OWNER_EMAIL`, gli ID Vapi/
   ElevenLabs, `CARTABIANCA_WINDOWS`. Lascia `WEBAPP_API_URL`/`WEBAPP_UI_URL`
   per dopo il deploy (passo 5).
4. **Segreti → Project Settings → Script Properties.** Aggiungi cinque chiavi
   (mai nel codice): `VAPI_GATEWAY_TOKEN` (genera con `openssl rand -hex 32`),
   `VAPI_PRIVATE_KEY`, `GEMINI_API_KEY`, `PUSHOVER_TOKEN`, `PUSHOVER_USER`.
5. Abilita il servizio avanzato **People API** (per `WhitelistSync.gs`).

Il router applica un'auth a 3 livelli: le chiamate macchina di Vapi usano il
token del gateway; le pagine (`live_view`, `outbound_console`) richiedono
l'identità Google del titolare; le AJAX delle pagine usano un token a vita
breve. Non devi configurarlo — è nel codice — ma è il motivo per cui il setup
qui sotto usa un unico deployment "Anyone".

## 5. Deploy del Web App

1. **Deploy → New deployment → Web app.** Esegui come *te*; accesso **Anyone**.
2. Copia l'URL `/exec`. Mettilo in `Config.gs` sia in `WEBAPP_API_URL` sia in
   `WEBAPP_UI_URL` (`WEBAPP_UI_URL = WEBAPP_API_URL`).
3. **Aggiorna il deployment** così esegue il codice con l'URL compilato:
   Deploy → Manage deployments → matita → Version: *New version*.
4. Nell'assistente Vapi imposta **Server URL** a
   `<WEBAPP_URL>?token=<VAPI_GATEWAY_TOKEN>&action=vapi_event`, e crea tre
   **tool** (`check_availability`, `book_appointment`, `get_secretary_info`)
   che puntano allo stesso URL con lo stesso token.

> **Regola d'oro:** usa un solo deployment e aggiornalo sempre **in place**
> (Manage deployments → matita → New version). L'URL `/exec` resta stabile.
> "New deployment" conia un URL nuovo e rompe la corrispondenza con `Config.gs`.

## 6. Recap giornalieri

Crea tre trigger time-based per `runMorningRecap`, `runAfternoonRecap`,
`runEveningRecap`. Imposta il fuso orario del progetto (Project Settings). I
recap usano la chiave Gemini e le credenziali Pushover già nelle Script
Properties.

## 7. Numero italiano (Zadarma) + SIP trunk

Vapi non vende numeri italiani. Si usa un DID Zadarma + un BYO SIP trunk.

**Critico:** l'integrazione usa un'**estensione del centralino (PBX)**, non
l'account SIP base di `my.zadarma.com/mysip/`. L'account SIP base richiede una
registrazione SIP attiva per chiamare in uscita; il trunk Vapi non si registra,
quindi le chiamate outbound falliscono con `407 proxy-authentication-required`.

1. Apri un account Zadarma, ricarica, ordina un DID italiano (richiede documento
   d'identità e prova di indirizzo).
2. Vai su **Il mio centralino** (`my.zadarma.com/mypbx/`). Sull'estensione `100`
   annota: server `pbx.zadarma.com`, login `NUMERO-100`, e la password SIP.
3. Assegna il DID al centralino.
4. Crea la credenziale BYO SIP trunk su Vapi:

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
         "authUsername": "NUMERO-100",
         "authPassword": "PASSWORD_ESTENSIONE"
       }
     }'
   ```

   **Non** aggiungere un `sipRegisterPlan` — causa il 407. Se una credenziale è
   stata patchata più volte e continua a dare 407, cancellala e ricreala da zero.
5. Crea la risorsa `byo-phone-number` su Vapi con il DID e il `credentialId` del
   passo 4.
6. Sull'estensione PBX Zadarma, imposta l'inoltro verso il SIP URI
   `+39TUONUMERO@sip.vapi.ai` (il percorso inbound).

## 8. Inoltro chiamate

Dal cellulare, inoltro condizionato verso il numero Zadarma con i codici GSM
(operatori italiani):

- Su mancata risposta (dopo 20s): `**61*+39TUONUMERO*11*20#`
- Su occupato/rifiutata: `**67*+39TUONUMERO#`
- Disattiva tutto: `##002#`

**Non** usare l'inoltro incondizionato.

## 9. Whitelist contatti

Esegui `syncContactsToWhitelist` una volta (`WhitelistSync.gs`), poi aggiungi un
trigger giornaliero (es. 03:00). Solo i chiamanti nei tuoi Google Contacts
raggiungono l'agente.

## 10. Test

- `testPush` (editor) → una notifica Pushover.
- `testRunMorningRecap` (editor) → un'email di recap + push.
- Chiama il tuo numero da un altro telefono, non rispondere → risponde l'agente.
- `testOutboundCall` (editor) → una chiamata di prova in uscita.
- Apri `<WEBAPP_URL>?action=outbound_console` loggato col tuo Google → la console
  si carica (e mostra "Accesso negato" se non sei il titolare).

---

## Problemi noti

### SIP `407 proxy-authentication-required`

Vedi il passo 7: usa un'estensione PBX (non l'account SIP base),
`pbx.zadarma.com`, niente `sipRegisterPlan`, e ricrea la credenziale da zero se
è stata patchata molte volte.

### Riassunto della chiamata nella lingua sbagliata

Il flusso outbound eredita la configurazione dell'assistente inbound via
`assistantId` + `assistantOverrides`. Assicurati che l'Analysis / Summary
dell'assistente inbound sia configurato in italiano — le chiamate outbound lo
specchiano.

### Provider push

Questo progetto usa Pushover, non ntfy.sh. L'istanza pubblica di ntfy.sh non è
raggiungibile in modo affidabile dalla rete di Apps Script (timeout
sull'hostname) e il suo free tier ha una quota giornaliera di messaggi;
`api.pushover.net` è raggiungibile direttamente e ha limiti ampi.
