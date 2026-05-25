// =====================================================================
//  RECAPS — Apps Script + Gemini 2.5 Flash
//  Tre volte al giorno: classifica le email importanti, crea bozze di
//  risposta standardizzabili, riassume l'agenda, invia email in Inbox
//  + push (Pushover).
//  Configurazione: vedi Config.gs e Script Properties.
// =====================================================================

// =====================================================================
//  ENTRY POINTS (uno per trigger time-based)
// =====================================================================

function runMorningRecap()   { runRecap('morning'); }
function runAfternoonRecap() { runRecap('afternoon'); }
function runEveningRecap()   { runRecap('evening'); }

// =====================================================================
//  CORE FLOW
// =====================================================================

function runRecap(type) {
  const cfg = getRecapConfig(type);
  console.log('=== ' + cfg.label + ' — ' + new Date().toISOString() + ' ===');

  const replyLabel = GmailApp.getUserLabelByName(REPLY_LABEL_NAME);
  if (!replyLabel) console.warn('Label "' + REPLY_LABEL_NAME + '" non trovata in Gmail.');

  const candidates = fetchCandidateEmails(cfg.hoursWindow);
  const important = classifyEmailsBatch(candidates);

  const draftsCreated = [];
  for (const email of important) {
    if (!email._decision.needsReply) continue;
    if (replyLabel) {
      try { GmailApp.getThreadById(email.threadId).addLabel(replyLabel); }
      catch (e) { console.error('Errore label per ' + email.subject + ': ' + e); }
    }
    if (email._decision.canDraftStandard) {
      try {
        const body = generateDraftBody(email);
        createReplyDraft(email, body);
        draftsCreated.push({ subject: email.subject, to: email.from });
      } catch (e) {
        console.error('Errore bozza per ' + email.subject + ': ' + e);
      }
    }
  }

  const events = fetchCalendarEvents(cfg.calendarFrom, cfg.calendarTo);

  const subject = cfg.label + ' — ' + formatDateIT(new Date());
  const bodyText = composeRecapBody(cfg, important, draftsCreated, events);
  const bodyHtml = markdownLightToHtml(bodyText);
  GmailApp.sendEmail(OWNER_EMAIL, subject, bodyText, {
    htmlBody: bodyHtml,
    name: 'Assistente personale'
  });

  const summary = generateSummary(important, draftsCreated, events, cfg);
  const tagsByType = { morning: 'sun', afternoon: 'partly_sunny', evening: 'crescent_moon' };
  sendPush(summary + '\n\nDettagli nella mail in Inbox.', cfg.label, {
    priority: 'default',
    tags: tagsByType[type] || 'bell',
    click: 'https://mail.google.com/mail/u/0/#inbox'
  });

  console.log('OK: ' + important.length + ' email importanti, ' + draftsCreated.length + ' bozze, ' + events.length + ' eventi.');
}

// =====================================================================
//  CONFIGS PER TIPO RECAP
// =====================================================================

function getRecapConfig(type) {
  const now = new Date();
  const today00 = new Date(now); today00.setHours(0,0,0,0);
  const today2359 = new Date(now); today2359.setHours(23,59,59,999);
  const tomorrow00 = new Date(today00); tomorrow00.setDate(tomorrow00.getDate()+1);
  const tomorrow2359 = new Date(today2359); tomorrow2359.setDate(tomorrow2359.getDate()+1);
  const now14 = new Date(now); now14.setHours(14,0,0,0);

  if (type === 'morning') {
    return {
      label: 'Recap mattina', emoji: '☀️', hoursWindow: 24,
      calendarFrom: today00, calendarTo: today2359,
      calendarSection: 'Agenda di oggi', emailSection: 'Email da gestire'
    };
  }
  if (type === 'afternoon') {
    return {
      label: 'Recap pomeriggio', emoji: '🌤️', hoursWindow: 8,
      calendarFrom: now14, calendarTo: today2359,
      calendarSection: 'Impegni del pomeriggio/sera', emailSection: 'Email arrivate da stamattina'
    };
  }
  return {
    label: 'Recap sera', emoji: '🌙', hoursWindow: 7,
    calendarFrom: tomorrow00, calendarTo: tomorrow2359,
    calendarSection: 'Agenda di domani', emailSection: 'Email del pomeriggio/sera'
  };
}

// =====================================================================
//  FETCH + CLASSIFY EMAIL
// =====================================================================

function fetchCandidateEmails(hoursWindow) {
  const query = 'is:unread newer_than:' + Math.ceil(hoursWindow/24) + 'd ' +
                '-category:promotions -category:social -category:updates -category:forums';
  const threads = GmailApp.search(query, 0, 50);
  const result = [];
  const cutoff = new Date(Date.now() - hoursWindow * 3600 * 1000);
  for (const th of threads) {
    const messages = th.getMessages();
    const last = messages[messages.length - 1];
    if (last.getDate() < cutoff) continue;
    result.push({
      threadId: th.getId(),
      messageId: last.getId(),
      from: last.getFrom(),
      subject: last.getSubject(),
      snippet: last.getPlainBody().substring(0, 600),
      date: last.getDate().toISOString()
    });
  }
  return result;
}

function classifyEmailsBatch(emails) {
  if (emails.length === 0) return [];
  const list = emails.map((e, i) => (i+1) + '. From: ' + e.from + '\n   Subject: ' + e.subject + '\n   Snippet: ' + e.snippet.substring(0, 400).replace(/\n/g, ' ')).join('\n\n');
  const prompt =
    'Sei un assistente che classifica email per Andrea Braschi, ingegnere informatico italiano.\n\n' +
    'Per CIASCUNA email decidi 3 flag booleani:\n\n' +
    '- "important": l\'email è rilevante per Andrea? TRUE per email da persone reali, comunicazioni operative (lavoro, fatture, scadenze, appuntamenti), contatti noti. FALSE per newsletter, marketing, notifiche automatiche di sistemi (GitHub, Calendar, social), conferme di acquisto.\n\n' +
    '- "needsReply": Andrea deve RISPONDERE personalmente? TRUE per domande dirette, richieste, conferme attese, "fammi sapere", proposte che richiedono accettazione/rifiuto. FALSE per email puramente informative ("FYI", "ti aggiorno"), notifiche, ringraziamenti generici, conferme automatiche, comunicazioni di sola lettura.\n\n' +
    '- "canDraftStandard": SOLO se needsReply=true, la risposta sarebbe breve e prevedibile? TRUE per: ringraziamenti, conferme ricezione, conferme appuntamento già fissato, disponibilità per data semplice, saluti cortesi. FALSE per: analisi tecniche, opinioni, decisioni, conflitti, negoziazioni, richieste cliente complesse, dubbio. Se needsReply=false, metti canDraftStandard=false.\n\n' +
    'NEL DUBBIO: meglio sottostimare (FALSE) che sovrastimare.\n\n' +
    'EMAIL:\n\n' + list + '\n\n' +
    'Rispondi SOLO con un array JSON di oggetti, uno per email IN ORDINE, formato esatto: [{"important":true,"needsReply":true,"canDraftStandard":false}, ...]. Niente testo extra.';

  const resp = callGemini(prompt);
  const decisions = parseJSONArray(resp, []);
  while (decisions.length < emails.length) decisions.push({ important: false, needsReply: false, canDraftStandard: false });
  const result = [];
  for (let i = 0; i < emails.length; i++) {
    const d = decisions[i] || {};
    if (d.important) {
      result.push(Object.assign({}, emails[i], { _decision: {
        needsReply: !!d.needsReply,
        canDraftStandard: !!d.needsReply && !!d.canDraftStandard
      }}));
    }
  }
  return result;
}

// =====================================================================
//  GENERAZIONE BOZZA DI RISPOSTA STANDARD
// =====================================================================

function generateDraftBody(email) {
  const prompt =
    'Scrivi una BREVE risposta in italiano (max 2-3 frasi) all\'email qui sotto, in stile asciutto e diretto come scrive Andrea Braschi.\n' +
    'NIENTE preamboli "Carissimo", NIENTE chiusure lunghe "Cordiali saluti". Stile: "Ciao [nome], [risposta]. A presto, Andrea." oppure "[Risposta]. Andrea."\n' +
    'Se l\'email è in inglese o altra lingua, rispondi in quella lingua mantenendo lo stesso stile asciutto.\n\n' +
    'EMAIL:\nFrom: ' + email.from + '\nSubject: ' + email.subject + '\nBody:\n' + email.snippet + '\n\n' +
    'Restituisci SOLO il testo della risposta, niente commenti.';
  return callGemini(prompt).trim();
}

function createReplyDraft(email, body) {
  const msg = GmailApp.getMessageById(email.messageId);
  msg.createDraftReply(body);
}

// =====================================================================
//  CALENDAR
// =====================================================================

function fetchCalendarEvents(from, to) {
  const events = CalendarApp.getDefaultCalendar().getEvents(from, to);
  return events.map(e => ({
    start: e.getStartTime(),
    end: e.getEndTime(),
    title: e.getTitle(),
    location: e.getLocation() || ''
  }));
}

// =====================================================================
//  COMPONI MAIL DI RECAP (markdown leggero)
// =====================================================================

function composeRecapBody(cfg, important, drafts, events) {
  const lines = [];
  lines.push('# ' + cfg.label + ' — ' + formatDateIT(new Date()));
  lines.push('');

  lines.push('## ' + cfg.emailSection + ' (' + important.length + ')');
  if (important.length === 0) {
    lines.push('Nessuna email importante da segnalare.');
  } else {
    for (const e of important) {
      const tags = [];
      if (e._decision && e._decision.needsReply) tags.push('To Reply');
      if (drafts.some(d => d.subject === e.subject)) tags.push('bozza pronta');
      const tagSuffix = tags.length ? ' [' + tags.join(' · ') + ']' : '';
      lines.push('- **' + cleanFrom(e.from) + '** — ' + e.subject + '.' + tagSuffix);
    }
  }
  lines.push('');

  if (drafts.length > 0) {
    lines.push('## Bozze di risposta create (' + drafts.length + ')');
    for (const d of drafts) {
      lines.push('- Re: ' + d.subject + ' → ' + cleanFrom(d.to));
    }
    lines.push('');
  }

  lines.push('## ' + cfg.calendarSection + ' (' + events.length + ' eventi)');
  if (events.length === 0) {
    lines.push(cfg.label.indexOf('sera') > -1 ? 'Agenda di domani libera.' :
               cfg.label.indexOf('pomeriggio') > -1 ? 'Resto della giornata libero.' : 'Agenda libera.');
  } else {
    for (const ev of events) {
      const startStr = Utilities.formatDate(ev.start, TIMEZONE, 'HH:mm');
      const endStr = Utilities.formatDate(ev.end, TIMEZONE, 'HH:mm');
      const loc = ev.location ? ' (' + ev.location + ')' : '';
      lines.push('- **' + startStr + '–' + endStr + '** — ' + ev.title + loc);
    }
  }
  lines.push('');

  lines.push('## In sintesi');
  lines.push(generateSummary(important, drafts, events, cfg));

  return lines.join('\n');
}

function generateSummary(important, drafts, events, cfg) {
  if (important.length === 0 && events.length === 0) {
    return cfg.label + ' tranquillo: nessuna email da gestire, ' + (cfg.calendarSection.indexOf('domani') > -1 ? 'agenda di domani' : 'agenda') + ' libera.';
  }
  const toReply = important.filter(e => e._decision && e._decision.needsReply).length;
  const parts = [];
  if (important.length > 0) {
    let s = important.length + ' email importanti';
    if (toReply > 0) s += ' (' + toReply + ' da rispondere, ' + drafts.length + ' bozze pronte)';
    parts.push(s);
  }
  if (events.length > 0) parts.push(events.length + ' impegni');
  return parts.join(', ') + '.';
}

// Markdown leggero → HTML basico. escapeHtml è definita in Vapi.gs.
function markdownLightToHtml(md) {
  return md
    .split('\n')
    .map(line => {
      if (line.startsWith('# ')) return '<h2 style="margin:8px 0">' + escapeHtml(line.substring(2)) + '</h2>';
      if (line.startsWith('## ')) return '<h3 style="margin:8px 0">' + escapeHtml(line.substring(3)) + '</h3>';
      if (line.startsWith('- ')) {
        const content = line.substring(2).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
        return '<div style="margin:2px 0 2px 16px">• ' + content + '</div>';
      }
      if (line.trim() === '') return '<br>';
      return '<div>' + escapeHtml(line) + '</div>';
    }).join('');
}

// =====================================================================
//  PUSH NOTIFICATIONS — Pushover
// =====================================================================

// Mappa le priorità in stile ntfy a quelle Pushover (-2..2).
function _pushoverPriority(p) {
  switch (String(p || 'default')) {
    case 'min': return -2;
    case 'low': return -1;
    case 'high': return 1;
    case 'urgent': return 1;   // Pushover 2 (emergency) richiede retry/expire: teniamo 1
    default: return 0;
  }
}

function sendPush(message, title, options) {
  const opts = options || {};
  const payload = {
    token: secret('PUSHOVER_TOKEN'),
    user: secret('PUSHOVER_USER'),
    message: String(message || '').substring(0, 1024),
    priority: String(_pushoverPriority(opts.priority))   // Pushover vuole la priority come stringa
  };
  if (title) payload.title = String(title).substring(0, 250);
  if (opts.click) { payload.url = opts.click; payload.url_title = 'Apri'; }
  // opts.tags (emoji ntfy) non ha equivalente in Pushover: ignorato.

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const resp = UrlFetchApp.fetch('https://api.pushover.net/1/messages.json', {
        method: 'post',
        payload: payload,
        muteHttpExceptions: true
      });
      const code = resp.getResponseCode();
      if (code === 200) return;
      if (code >= 400 && code < 500) {  // token/user errati: inutile ritentare
        console.error('Pushover HTTP ' + code + ': ' + resp.getContentText().substring(0, 200));
        return;
      }
      console.warn('Pushover try ' + attempt + ': HTTP ' + code);
    } catch (e) {
      console.warn('Pushover try ' + attempt + ' exception: ' + e);
    }
  }
  console.error('Pushover: invio fallito');
}

// =====================================================================
//  HELPERS
// =====================================================================

function callGemini(prompt, maxTokens) {
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + GEMINI_MODEL + ':generateContent?key=' + secret('GEMINI_API_KEY');
  const payload = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.3, maxOutputTokens: maxTokens || 1024 }
  };
  const opts = {
    method: 'POST',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  const MAX_RETRIES = 4;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const resp = UrlFetchApp.fetch(url, opts);
    const code = resp.getResponseCode();
    if (code === 200) {
      try {
        return JSON.parse(resp.getContentText()).candidates[0].content.parts[0].text || '';
      } catch (e) {
        console.error('Gemini parse error: ' + e);
        return '';
      }
    }
    if ((code === 503 || code === 429) && attempt < MAX_RETRIES) {
      const waitMs = attempt * 1500;
      console.warn('Gemini HTTP ' + code + ' — tentativo ' + attempt + '/' + MAX_RETRIES + ', retry tra ' + waitMs + 'ms');
      Utilities.sleep(waitMs);
      continue;
    }
    console.error('Gemini HTTP ' + code + ': ' + resp.getContentText().substring(0, 300));
    return '';
  }
  return '';
}

function parseJSONArray(text, fallback) {
  if (!text) return fallback;
  const cleaned = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
  try { return JSON.parse(cleaned); } catch (e) {
    const m = cleaned.match(/\[[\s\S]*\]/);
    if (m) { try { return JSON.parse(m[0]); } catch (e2) {} }
    console.warn('parseJSONArray fallback: ' + cleaned.substring(0, 200));
    return fallback;
  }
}

function cleanFrom(from) {
  const m = from.match(/^(.+?)\s*<.+>$/);
  if (m) return m[1].replace(/"/g, '');
  return from;
}

function formatDateIT(d) {
  return Utilities.formatDate(d, TIMEZONE, 'dd/MM/yyyy');
}

// =====================================================================
//  TEST FUNCTIONS (eseguibili dall'editor)
// =====================================================================

function testRunMorningRecap()   { runMorningRecap(); }
function testRunAfternoonRecap() { runAfternoonRecap(); }
function testRunEveningRecap()   { runEveningRecap(); }

function testGemini() {
  const out = callGemini('Rispondi con la parola "ok" e basta.');
  console.log('Risposta Gemini: ' + out);
}

function testPush() {
  sendPush('Test push da Recap.gs', 'Test Pushover', { priority: 'high' });
}
