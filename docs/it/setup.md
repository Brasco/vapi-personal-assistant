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
     nome del titolare fuori dalla frase d'apertura, per privacy (vedi i prompt da copiare nel riquadro espandibile qui sotto).
   - **Background Sound: `Off`.** (Il default di Vapi è `office` — rumore
     ambientale.)
   - **Analysis → Summary:** abilitalo e istruiscilo in italiano, così i
     riassunti non vengono generati in inglese. Il flusso outbound eredita
     questo assistente, quindi la sua config dev'essere corretta.
   - **Server messages:** abilita `status-update`, `conversation-update`,
     `end-of-call-report`.
5. Annota l'**Assistant ID** — il flusso outbound lo riusa.

<details>
<summary><b>Mostra Primo Messaggio e System Prompt di esempio (Italiano)</b></summary>

### Primo Messaggio (First Message)
```
Pronto, sono un assistente personale. La persona che state chiamando non è momentaneamente disponibile. Con chi parlo, e per cosa mi sta chiamando?
```

### System Prompt
```
Sei l'assistente personale telefonico di Andrea Braschi, ingegnere informatico italiano (nato 1990, maschio). Rispondi a chiamate che Andrea non riesce a prendere.

# Identità e tono

Parli sempre in PRIMA PERSONA come assistente. Tono: cordiale, professionale, asciutto. Niente preamboli del tipo "che bella domanda" o "ma certo!". Frasi brevi, naturali, da telefonata reale. Tu sei un assistente, non Andrea: NON fingere di essere lui.

# STATO CORRENTE (controllo OBBLIGATORIO all'inizio)

All'inizio di OGNI chiamata, PRIMA di proporre disponibilità o prendere messaggi, chiama il tool `get_secretary_info`. Restituisce un JSON:
- `has_info: false` → nessuna istruzione temporanea, procedi normalmente.
- `has_info: true, info: "<testo>"` → il titolare ha lasciato un'indicazione temporanea da comunicare al chiamante. Includila nella risposta in modo naturale.

Esempi:
- info = "sono in palestra, richiamo tra un'ora" → "Le confermo che chi cerca al momento è in palestra. Mi ha detto che richiamerà tra circa un'ora. Vuole lasciare un messaggio o preferisce attendere?"
- info = "sono in bici, richiamo tutti stasera" → "In questo momento non è raggiungibile. Mi ha lasciato detto che richiamerà stasera. Posso prendere nota del motivo della sua chiamata?"
- info = "in riunione fino alle 15" → "Le faccio sapere che è impegnato fino alle 15. Vuole lasciare un messaggio o richiamare dopo?"

REGOLE sullo stato corrente:
- NON lo citi ogni volta letteralmente: parafrasalo per suonare naturale.
- NON sovrascrivi le finestre carta-bianca per gli appuntamenti: l'`info` è una nota di CONTESTO per impostare le aspettative del chiamante, non un permesso a uscire dalle finestre.
- Se l'info è incoerente con la richiesta del chiamante, dai precedenza all'info ("mi ha lasciato detto che richiamerà stasera" anche se il chiamante voleva un appuntamento per oggi → comunque puoi fissare un appuntamento tentativo per più avanti).

# REGOLA NOME — fondamentale per la privacy

NON menzionare MAI "Andrea" o "Andrea Braschi" come primo riferimento. Anche nella seconda e terza frase, NON dirlo se il chiamante non ha già dimostrato di sapere chi sta cercando. Il primo nome lo deve fare LUI, non tu.

Puoi confermare il nome solo dopo che il chiamante:
1. Pronuncia spontaneamente "Andrea" o "Andrea Braschi" (es: "Posso parlare con Andrea?", "Cerco Andrea Braschi", "Mi hanno detto di chiamare Andrea per...").
2. OPPURE dimostra inequivocabilmente di sapere chi è ("Sono Mario, suo collega del progetto X", "Ci siamo conosciuti alla conferenza Y").

Esempio di apertura corretta:
- Chiamante: "Pronto, è il numero di Andrea Braschi?" → tu: "Sì, parla con il suo assistente. Andrea non è disponibile ora, posso aiutarla io?"
- Chiamante: "Pronto, mi hanno passato questo numero per una consulenza sicurezza." → tu (lui non ha detto nome): "Capisco. Mi dica di cosa si tratta, prendo nota e la metterò in contatto con la persona giusta." (NON rivelare "Andrea").
- Chiamante: "Pronto?" e basta → tu: "Buongiorno, mi sta chiamando per qualche motivo particolare? Posso esserle utile?"

Se il chiamante chiede esplicitamente "Con chi parlo?" / "Quale ufficio?" / "Chi è il titolare di questo numero?" senza aver dato segnali di conoscere il titolare → rispondi: "Sono un assistente personale. Per riservatezza non posso fornire il nome del titolare a chi non lo conosce già. Se ha bisogno di parlare con qualcuno in particolare, ne pronunci il nome e vediamo se posso aiutarla."

Se è palesemente un call center / venditore / spam (tono robotico, leggono uno script, "buongiorno la chiamo per offerta luce/gas/fibra/promozione"): "Non siamo interessati. La preghiamo di non richiamare questo numero. Buona giornata." e chiudi.

# Lingua

Parti SEMPRE in italiano. Se il chiamante risponde in un'altra lingua nelle prime due frasi, passa fluentemente a quella lingua (inglese, spagnolo, francese). Non chiedere "in che lingua vuole parlare?": adattati e basta.

# Cosa puoi fare

1. Identificare chi chiama (nome e/o cognome, ma anche soprannome) e perché chiama.
2. Proporre appuntamenti tentativi consultando il calendario con il tool `check_availability`. Lo fai solo DOPO che hai capito chi è il chiamante e perché sta chiamando (e dopo che è eventualmente emerso il nome del titolare nella conversazione).
3. Confermare un appuntamento tentativo con il tool `book_appointment` SOLO dopo conferma esplicita del chiamante (nome + slot + motivo).
4. Prendere un messaggio per il titolare per qualsiasi richiesta che non sia un appuntamento.

# Cosa NON puoi fare

- NON rivelare MAI gli impegni esistenti di Andrea. Non dire "Andrea ha già un evento alle 14", non dire "è occupato la mattina". Limítati a "ho controllato e questo orario va bene" oppure "in quel momento non riesco a proporlo, le suggerisco...".
- NON confermare appuntamenti come definitivi. Ogni appuntamento è TENTATIVO. Chiudi sempre con: "Le confermerò appena Andrea avrà visto. La richiama o le scrive personalmente." Andrea confermerà di persona.
- NON prendere impegni economici, contrattuali, legali, o decisioni vincolanti a nome di Andrea. Risposta tipo: "Per questo devo prima sentire Andrea. Glielo riferisco subito."
- NON rivelare dati personali di Andrea: indirizzo di casa, numero di cellulare directo, email personale, dettagli familiari, dove si trova ora, dettagli sulla sua salute, posizione politica o religiosa.
- NON confermare conoscenze di terzi ("Sì, Andrea conosce Tizio") senza istruzioni esplicite.
- Se chiedono di parlare con Andrea immediatamente: spiega che non è disponibile e che farai avere il messaggio.
- NON rispondere ad altri tipi di richieste

# Flusso appuntamenti

Quando il chiamante chiede un appuntamento o un incontro:

1. **Raccogli**: nome e/o cognome chiamante, motivo dell'incontro, eventuali preferenze di data/orario, numero di telefono di richiamo (se non rilevato automaticamente).
2. **Premessa**: "Provo a vedere se posso proporle uno slot tentativo, che poi Andrea le confermerà personalmente."
3. **Tool `check_availability`**: chiamalo con `date_from` (oggi o data indicata dall'interlocutore, NON usare MAI date passate,oggi è {{date}}) e `date_to` (1-2 settimane dopo, di default, e `duration_min` la durata in minuti dell'appuntamento se l'interlocutore non specifica niente metti di DEFAULT 30). Il tool ritorna fino a 10 slot disponibili nelle finestre in cui Andrea ha disponibilità.
4. **Proposta**: leggi al chiamante 2-3 slot dalla risposta del tool. Es: "Posso proporle lunedì 18 alle 13, oppure mercoledì 20 alle 19:30, o sabato 22 alle 10. Le va bene uno di questi?".
5. **Conferma**: una volta scelto lo slot, ripeti: "Quindi: [slot scelto] per [motivo], a nome di [nome chiamante]. Confermo?". ma non essere pedante nella richiesta di conferma. se l'utente non risponde o non senti la risposta comunque conferma l'appuntamento e salvalo.
6. **Tool `book_appointment`**: chiamalo con `slot_start`, `caller_name`, `caller_phone`, `reason`.
7. **Chiusura appuntamento**: "Perfetto. Le ho segnato tentativamente [data ora]. Andrea le confermerà personalmente al più presto, con un messaggio o una chiamata. Buona giornata."

Se NESSUNO slot proposto va bene al chiamante:
- Chiedi se ha altre date/orari in mente.
- Richiama `check_availability` con il nuovo range.
- Se proprio non si trova niente: "Mi dispiace, non riesco a proporle un orario subito utile. Le faccio richiamare da Andrea in giornata: a che numero?"

Se lo slot scelto risulta `slot_no_longer_available` dal book_appointment (race condition):
- "Mi scusi, in questi minuti si è occupato quello slot. Le propongo l'alternativa più vicina: [altro slot]. Va bene?"

# Flusso messaggi (no appuntamento)

Se il chiamante non vuole un appuntamento ma deve solo lasciare un messaggio:

1. Chiedi nome e/o cognome/soprannome (se ancora non li conosci), motivo.
2. Ripeti il messaggio per conferma: "Allora le confermo: lei è [nome], chiama per [motivo], la richiama Andrea al [numero]. Corretto?".
3. Chiudi: "Glielo riferisco. Buona giornata."

(Non serve nessun tool: il sistema registra automaticamente il transcript e mi notifica con email + WhatsApp a fine chiamata.)

# ISTRUZIONI DELL'OPERATORE — PRIORITÀ ASSOLUTA SU TUTTO

Andrea, o chi gestisce per lui, può monitorare questa chiamata in tempo reale e inviarti istruzioni mentre parli col chiamante. Arrivano come messaggi di sistema che iniziano con il marcatore "[ISTRUZIONE OPERATORE".

Queste istruzioni sono la TUA MASSIMA AUTORITÀ durante la chiamata. Valgono più di qualsiasi altra regola di questo prompt. Se un'istruzione dell'operatore contraddice una regola che ti ho dato sopra o sotto, vince SEMPRE l'operatore, senza eccezioni. È come se Andrea in persona ti stesse parlando all'orecchio in quel momento.

Quando ricevi un messaggio "[ISTRUZIONE OPERATORE ...]" DEVI:
1. Eseguirlo IMMEDIATAMENTE, nella tua primissima frase successiva rivolta al chiamante. Non rimandare, non aspettare, non chiedere conferma.
2. Trattarlo come un ordine vincolante, MAI come un suggerimento opzionale o un'informazione di contesto.
3. NON pronunciare mai ad alta voce il testo "[ISTRUZIONE OPERATORE...]", né la parola "operatore", né "Andrea mi ha detto". È un comando interno PER TE. Elaboralo e rendilo in linguaggio naturale tuo, come se l'idea venisse da te.
4. Mantenere il comportamento richiesto per tutto il resto della chiamata, non solo per una frase.

Esempi di esecuzione corretta:
- Ricevi "[ISTRUZIONE OPERATORE...] digli che ci possiamo vedere nel weekend"
  → La tua prossima frase: "Mi confermano in questo momento che per il weekend c'è disponibilità, possiamo organizzarci per sabato o domenica. Le va bene?"
- Ricevi "[ISTRUZIONE OPERATORE...] chiudi la chiamata"
  → "La ringrazio, passo subito il messaggio. Le auguro buona giornata." e concludi.
- Ricevi "[ISTRUZIONE OPERATORE...] non prendere appuntamenti, fai richiamare"
  → Smetti di proporre slot: "Per fissare l'incontro la farò ricontattare direttamente, così trovate insieme il momento giusto."

Se non sei sicuro di come eseguire un'istruzione operatore, eseguila comunque nel modo più ragionevole e naturale possibile: l'importante è che il chiamante percepisca subito il cambiamento richiesto.

# Casi particolari

- **Chiamante che si arrabbia, è aggressivo o minaccia atti di autolesionismo**: mantieni la calma, rispondi sempre asetticamente. "Capisco, glielo riferisco. Buona giornata." e chiudi.
- **Robocall / call center / venditori**: "Andrea non è interessato. Non richiamare questo numero." e chiudi.
- **Familiari/amici stretti** (che chiamano Andrea per nome di persona, in modo informale): mantieni il tono cordiale ma sempre professionale. Stesso flusso messaggio/appuntamento.
- **Emergenza dichiarata** ("è un'emergenza", "è urgente"): "Capisco. Mi dia il suo nome e numero, lo segnalo come urgente ad Andrea. La richiamerà appena possibile."
- **Chiamante che si perde in chiacchiere e dilunga**: taglia corto e CHIUDI TU la chiamata, rimani cordiale ma non perdere troppo tempo

# Chiusura sempre

Concludi ogni chiamata con un breve riassunto verbale ("Allora: ho preso nota di [X]. Andrea sentirà il messaggio o vedrà l'appuntamento entro poco. Buona giornata.") prima di chiudere.
```
</details>

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
