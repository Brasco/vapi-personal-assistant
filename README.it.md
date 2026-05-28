# Assistente vocale personale

Un assistente telefonico personale e un sistema di recap email/calendario,
costruiti interamente su **Google Apps Script + Vapi + Gemini**, con
un'architettura privacy-by-design. Risponde alle chiamate che non riesci a
prendere con una copia clonata della tua voce, fissa appuntamenti tentativi sul
tuo calendario, chiama attività per tuo conto e ti invia tre recap
email/calendario al giorno.

> 🇬🇧 English version: [README.md](README.md)

> **Stato:** progetto personale funzionante, in produzione. Lo strato di
> telefonia è specifico per l'Italia (vedi [Ambito](#ambito)).

## Cosa fa

- **Agente vocale inbound.** Le chiamate che non rispondi vengono inoltrate a un
  agente AI che parla con un clone della tua voce. Identifica il chiamante,
  prende un messaggio o propone slot di appuntamento dal tuo calendario.
- **Chiamate in uscita.** Da una console web descrivi una telefonata da fare
  ("prenota un tavolo al ristorante X"); Gemini la trasforma in un brief e
  l'agente effettua la chiamata per te, parlando in prima persona.
- **Monitoraggio live.** Mentre una chiamata è in corso ricevi una notifica
  push; toccandola apri la trascrizione live dove puoi suggerire all'agente una
  frase, dargli un'istruzione silenziosa o riagganciare.
- **Tre recap giornalieri.** Alle 06:00 / 14:00 / 21:00 il sistema classifica le
  email importanti non lette, crea bozze di risposta per quelle standardizzabili,
  riassume l'agenda e invia un'email di dettaglio più una breve notifica push.
- **Whitelist contatti.** Solo i chiamanti presenti nei tuoi Google Contacts
  raggiungono l'agente; i numeri sconosciuti ricevono un cortese "non
  disponibile" e vengono riagganciati.

## Perché questa architettura

Cosa distingue questo sistema dai prodotti "AI receptionist" già pronti:

- **Gateway di privacy.** Il provider vocale (Vapi) non ha mai accesso diretto
  al tuo Google Calendar. Ogni lettura/scrittura passa da un Web App Apps Script
  che possiedi tu, che espone solo slot liberi/occupati dentro finestre che
  definisci tu — mai i tuoi eventi reali.
- **Conferma posticipata.** L'agente non prenota mai nulla come definitivo. Ogni
  appuntamento è *tentativo*; lo confermi tu personalmente dopo.
- **Doppio canale di notifica.** Un ping push breve per la consapevolezza,
  un'email completa (con transcript) per il dettaglio.
- **Costo trasparente.** Circa 13–18 €/mese, tutto incluso. Nessun piano
  "starter" da 99 $.

## Architettura

```
                          ┌───────────────────────────┐
  Chiamante ─(persa)─▶    │  Operatore mobile         │
                          │  inoltro condizionato     │
                          └────────────┬──────────────┘
                                       ▼
                          ┌───────────────────────────┐
                          │  Zadarma (SIP trunk, +39) │
                          └────────────┬──────────────┘
                                       ▼
   ┌──────────────────────────────────────────────────────────┐
   │  Vapi  — STT (Deepgram) · LLM (GPT-4o) · TTS (ElevenLabs)│
   └───────────────┬───────────────────────┬──────────────────┘
                   │ tool calls            │ webhook (eventi)
                   ▼                       ▼
   ┌──────────────────────────────────────────────────────────┐
   │  Web App Apps Script  (il "gateway" — lo possiedi tu)    │
   │  • check_availability / book_appointment  → Calendar     │
   │  • status-update / end-of-call   → Pushover + Gmail      │
   │  • monitor live (dire / istruire / riagganciare)         │
   │  • console outbound + generatore di brief con Gemini     │
   └──────────────────────────────────────────────────────────┘

   Recap (indipendenti): trigger Apps Script → Gemini → Gmail + Pushover
```

Il provider vocale parla sempre e solo con il *tuo* gateway. Il gateway tiene la
logica e i confini.

## Componenti

Tutto il codice sta in [`apps-script/`](apps-script/) — un unico progetto Apps
Script:

| File | Ruolo |
|------|-------|
| `Config.gs` | Configurazione non segreta centralizzata + helper `secret()` che legge i segreti dalle Script Properties. |
| `Vapi.gs` | Il gateway: router con auth a 3 livelli, tool calendario, webhook chiamate, monitor live, chiamate in uscita, endpoint Gemini. |
| `Recap.gs` | I tre recap email/calendario giornalieri. Classificazione email e bozze via Gemini. `sendPush` (Pushover) sta qui, condivisa con `Vapi.gs`. |
| `WhitelistSync.gs` | Sync notturno dei Google Contacts in una whitelist locale. |
| `LiveCall.html` | Pagina di monitoraggio live della chiamata (servita dal gateway). |
| `OutboundConsole.html` | Console web per comporre e lanciare le chiamate in uscita. |

## Modello di autenticazione

Un solo deployment Apps Script, accesso "Anyone". L'auth è applicata **nel
router**, per tipo di azione:

- **Azioni macchina** (webhook/tool di Vapi) → un token master, nelle Script
  Properties. Vapi è un server e non può fare login Google.
- **Azioni pagina** (`live_view`, `outbound_console`) → `Session.getActiveUser()`
  deve essere uguale all'email del titolare. Su un deployment "Anyone" questa
  restituisce l'email del titolare a lui e una stringa vuota a chiunque altro.
- **Azioni AJAX** (le fetch interne alle pagine) → un token a vita breve,
  generato server-side al caricamento della pagina (CacheService, TTL 2h). Il
  token master non raggiunge mai il browser.

## Costi

Circa **13–18 €/mese** per uso personale (~30 chiamate/mese da ~2 min), più
**5 $** una tantum per la licenza dell'app Pushover:

| Voce | Costo |
|------|-------|
| Piattaforma Vapi | ~3 $/mese |
| ElevenLabs (Starter, voice clone + TTS) | 5 $/mese |
| LLM (GPT-4o) | ~2 $/mese |
| Deepgram STT | incluso nel credito Vapi |
| DID italiano Zadarma | ~4 $/mese (fatturato annuale) |
| Gemini API (recap) | free tier |
| Pushover | 5 $ una tantum, poi gratis (10k msg/mese) |

## Prerequisiti

Account: Google (Apps Script, Calendar, Gmail, Contacts), [Vapi](https://vapi.ai),
[ElevenLabs](https://elevenlabs.io), [Zadarma](https://zadarma.com),
[API key Gemini](https://aistudio.google.com/apikey) e
[Pushover](https://pushover.net).

## Setup

**Non** è un setup da cinque minuti — metti in conto un paio d'ore e leggi con
attenzione. Guida passo-passo completa: **[docs/it/setup.md](docs/it/setup.md)**.

## Configurazione

Nessun segreto è committato in questo repo.

- La **config non segreta** sta in `Config.gs` come costanti: email del
  titolare, id calendario, gli ID Vapi/ElevenLabs, l'URL del deployment, le
  finestre di disponibilità. Cerca `REPLACE_WITH_...` e `youremail@example.com`
  e compilali.
- I **segreti** stanno nelle **Script Properties** (Apps Script → Project
  Settings → Script Properties), mai nel codice: `VAPI_GATEWAY_TOKEN`,
  `VAPI_PRIVATE_KEY`, `GEMINI_API_KEY`, `PUSHOVER_TOKEN`, `PUSHOVER_USER`.

Il codice usa anche **"Andrea Braschi"** come nome del titolare di esempio in
alcuni prompt — sostituiscilo col tuo.

## Deployment

Usa **un solo** deployment, e aggiornalo sempre **in place**: Apps Script →
Deploy → Manage deployments → matita → *New version*. L'URL `/exec` resta
stabile. Mai usare "New deployment": conia un URL nuovo e quello dentro
`Config.gs` non corrisponderà più al deployment in esecuzione.

## Note di sicurezza

- Tieni ogni segreto **solo** nelle Script Properties — mai nel repo.
- Il token master del gateway è usato solo dalle chiamate macchina di Vapi e non
  raggiunge mai il browser; le pagine sono protette dalla tua identità Google;
  le loro AJAX usano un token a vita breve.
- La registrazione è disattivata di default (solo transcript). Se attivi la
  registrazione delle chiamate, in molti paesi devi annunciarlo al chiamante.
- Clonare la propria voce è lecito; clonare quella di altri senza consenso no.

## Ambito

Lo strato di telefonia è **specifico per l'Italia**: assume un DID italiano
Zadarma (+39), i codici GSM italiani per l'inoltro, e la normalizzazione dei
numeri italiani. La logica di recap e del gateway è indipendente dal paese; le
parti telefoniche andrebbero adattate per altri paesi.

## Licenza

[MIT](LICENSE) — © 2026 Andrea Braschi.
