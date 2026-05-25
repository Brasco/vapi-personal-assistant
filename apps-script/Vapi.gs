// ====================================================================
//  GATEWAY VAPI — calendario, webhook chiamate, live monitor, outbound
// ====================================================================
//  Configurazione: vedi Config.gs (costanti) e Script Properties
//  (segreti, letti con secret('...')).
// ====================================================================

// --------------------------------------------------------------------
//  AUTH — classificazione delle action (router a 3 livelli)
// --------------------------------------------------------------------
//  MACHINE: chiamate da Vapi (server, niente login) -> token master.
//  PAGE   : pagine HTML aperte dal titolare -> login Google + OWNER_EMAIL.
//  AJAX   : fetch interne alle pagine -> token UI a vita breve.
const MACHINE_ACTIONS = ['check_availability', 'book_appointment', 'get_secretary_info',
                         'end_of_call', 'status_update', 'vapi_event'];
const PAGE_ACTIONS    = ['live_view', 'outbound_console'];
const AJAX_ACTIONS    = ['get_monitor', 'get_transcript', 'send_say', 'send_background',
                         'hangup', 'gemini_chat', 'start_outbound_call'];

// Token UI a vita breve: generato al caricamento di una pagina, iniettato
// server-side nel template, validato sulle action AJAX. Non e' mai in un
// URL visibile e scade dopo 2h. Il token master non raggiunge il browser.
function mintUiToken() {
  const tok = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  CacheService.getScriptCache().put('uitok:' + tok, '1', 7200);
  return tok;
}
function isValidUiToken(tok) {
  if (!tok) return false;
  return CacheService.getScriptCache().get('uitok:' + tok) === '1';
}

// ====================================================================
//  ROUTER ENDPOINT
// ====================================================================

function doGet(e)  { return handleRequest(e, 'GET'); }
function doPost(e) { return handleRequest(e, 'POST'); }

function handleRequest(e, method) {
  try {
    const params = (e && e.parameter) || {};
    const action = params.action || '';
    let body = {};
    if (method === 'POST' && e.postData && e.postData.contents) {
      try { body = JSON.parse(e.postData.contents); } catch (err) { body = {}; }
    }

    // --- AUTH a 3 livelli ---
    if (PAGE_ACTIONS.indexOf(action) >= 0) {
      // pagine HTML: solo il titolare loggato con Google
      if (Session.getActiveUser().getEmail() !== OWNER_EMAIL) {
        return HtmlService.createHtmlOutput(
          '<h2>Accesso negato</h2><p>Questa pagina e\' riservata al titolare.</p>');
      }
    } else if (AJAX_ACTIONS.indexOf(action) >= 0) {
      // fetch interne alle pagine: token UI a vita breve
      const uitok = params.uitok || body.uitok || '';
      if (!isValidUiToken(uitok)) {
        return jsonOut({ error: 'unauthorized' }, 401);
      }
    } else if (MACHINE_ACTIONS.indexOf(action) >= 0) {
      // chiamate macchina da Vapi: token master
      if (params.token !== secret('VAPI_GATEWAY_TOKEN')) {
        return jsonOut({ error: 'unauthorized' }, 401);
      }
    } else {
      return jsonOut({ error: 'unknown_action', action: action }, 404);
    }

    // --- DISPATCH ---
    switch (action) {
      case 'check_availability':  return checkAvailability(params, body);
      case 'book_appointment':    return bookAppointment(params, body);
      case 'end_of_call':         return endOfCall(params, body);
      case 'get_secretary_info':  return getSecretaryInfoEndpoint();
      case 'status_update':       return statusUpdate(params, body);
      case 'vapi_event':          return dispatchVapiEvent(body);
      case 'live_view':           return liveViewPage(params);
      case 'outbound_console':    return outboundConsolePage(params);
      case 'get_monitor':         return getMonitor(params);
      case 'get_transcript':      return getTranscriptEndpoint(params);
      case 'send_say':            return sendSay(params, body);
      case 'send_background':     return sendBackgroundMessage(params, body);
      case 'hangup':              return sendHangup(params, body);
      case 'gemini_chat':         return geminiChat(params, body);
      case 'start_outbound_call': return startOutboundCall(params, body);
      default:                    return jsonOut({ error: 'unknown_action' }, 404);
    }
  } catch (err) {
    console.error('handleRequest error: ' + err + '\n' + err.stack);
    return jsonOut({ error: 'internal', detail: String(err) }, 500);
  }
}

function dispatchVapiEvent(body) {
  const msg = (body && body.message) || body;
  const t = (msg.type || '').toString();
  if (t === 'end-of-call-report') return endOfCall({}, body);
  if (t === 'status-update') return statusUpdate({}, body);
  if (t === 'conversation-update') return handleConversationUpdate(body);
  return jsonOut({ ok: true, ignored: true, type: t }, 200);
}

function jsonOut(obj, statusCode) {
  const payload = Object.assign({}, obj, { _status: statusCode || 200 });
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

// ====================================================================
//  ACTION: check_availability
// ====================================================================

function checkAvailability(params, body) {
  const dateFromStr = params.date_from || todayISO();
  const dateToStr = params.date_to || addDaysISO(dateFromStr, 14);
  const durationMin = parseInt(params.duration_min || APPOINTMENT_DURATION_MIN_DEFAULT, 10);

  const dateFrom = parseDateISO(dateFromStr);
  const dateTo = parseDateISO(dateToStr);
  dateTo.setHours(23, 59, 59);

  const calendar = CalendarApp.getCalendarById(CALENDAR_ID);
  const busyEvents = calendar.getEvents(dateFrom, dateTo).filter(ev => isBlockingEvent(ev));

  const candidates = generateCandidateSlots(dateFrom, dateTo, durationMin);

  const available = candidates.filter(slot => {
    const slotEnd = new Date(slot.getTime() + durationMin * 60000);
    return !busyEvents.some(ev => overlaps(slot, slotEnd, ev.getStartTime(), ev.getEndTime()));
  });

  const out = available.slice(0, 10).map(d => Utilities.formatDate(d, TIMEZONE, "yyyy-MM-dd'T'HH:mm:ssXXX"));
  return jsonOut({ available_slots: out, count: out.length, duration_min: durationMin }, 200);
}

function generateCandidateSlots(dateFrom, dateTo, durationMin) {
  const slots = [];
  const cursor = new Date(dateFrom);
  cursor.setSeconds(0, 0);

  while (cursor < dateTo) {
    const dow = cursor.getDay();
    const windowsToday = CARTABIANCA_WINDOWS.filter(w => w.day === dow);
    for (const w of windowsToday) {
      const winStart = new Date(cursor);
      winStart.setHours(w.startHour, w.startMin, 0, 0);
      const winEnd = new Date(cursor);
      winEnd.setHours(w.endHour, w.endMin, 0, 0);

      for (let t = new Date(winStart); t.getTime() + durationMin * 60000 <= winEnd.getTime(); t = new Date(t.getTime() + 30 * 60000)) {
        if (t > new Date()) slots.push(new Date(t));
      }
    }
    cursor.setDate(cursor.getDate() + 1);
    cursor.setHours(0, 0, 0, 0);
  }
  return slots;
}

function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

// ====================================================================
//  ACTION: book_appointment
// ====================================================================

function bookAppointment(params, body) {
  const required = ['slot_start', 'caller_name', 'reason'];
  for (const k of required) {
    if (!body[k]) return jsonOut({ error: 'missing_field', field: k }, 400);
  }
  const slotStart = new Date(body.slot_start);
  if (isNaN(slotStart.getTime())) return jsonOut({ error: 'invalid_slot_start' }, 400);
  const durationMin = parseInt(body.duration_min || APPOINTMENT_DURATION_MIN_DEFAULT, 10);
  const slotEnd = new Date(slotStart.getTime() + durationMin * 60000);

  const calendar = CalendarApp.getCalendarById(CALENDAR_ID);
  const conflicts = calendar.getEvents(slotStart, slotEnd).filter(ev => isBlockingEvent(ev));
  if (conflicts.length > 0) {
    return jsonOut({ booked: false, reason: 'slot_no_longer_available' }, 200);
  }

  if (!isSlotInCartabianca(slotStart, slotEnd)) {
    return jsonOut({ booked: false, reason: 'slot_outside_cartabianca' }, 200);
  }

  const title = 'TENTATIVO — ' + body.reason + ' con ' + body.caller_name;
  const description =
    'Appuntamento TENTATIVO segnato dall\'AI assistant.\n\n' +
    'Chiamante: ' + body.caller_name + '\n' +
    'Telefono: ' + (body.caller_phone || 'non fornito') + '\n' +
    'Motivo: ' + body.reason + '\n' +
    'Fissato il: ' + Utilities.formatDate(new Date(), TIMEZONE, 'dd/MM/yyyy HH:mm') + '\n\n' +
    'DA CONFERMARE dal titolare.';

  const event = calendar.createEvent(title, slotStart, slotEnd, { description: description });
  event.setColor(CalendarApp.EventColor.RED);

  return jsonOut({
    booked: true,
    event_id: event.getId(),
    message: 'Appuntamento tentativo segnato per ' + Utilities.formatDate(slotStart, TIMEZONE, 'EEEE dd MMMM yyyy HH:mm') + '. Sara\' confermato personalmente.'
  }, 200);
}

function isSlotInCartabianca(slotStart, slotEnd) {
  const dow = slotStart.getDay();
  const windowsToday = CARTABIANCA_WINDOWS.filter(w => w.day === dow);
  return windowsToday.some(w => {
    const winStart = new Date(slotStart);
    winStart.setHours(w.startHour, w.startMin, 0, 0);
    const winEnd = new Date(slotStart);
    winEnd.setHours(w.endHour, w.endMin, 0, 0);
    return slotStart >= winStart && slotEnd <= winEnd;
  });
}

// ====================================================================
//  ACTION: end_of_call (webhook Vapi end-of-call-report)
//  Azione: push immediata (Pushover) + email in Inbox con transcript
// ====================================================================

function endOfCall(params, body) {
  const msg = (body && body.message) || body;

  const type = (msg.type || msg.event || '').toString();
  if (type !== 'end-of-call-report') {
    return jsonOut({ ok: true, ignored: true, type: type }, 200);
  }

  const call = msg.call || {};
  const customer = call.customer || {};
  const callerPhone = customer.number || msg.phoneNumber || 'sconosciuto';
  const isOutbound = (call.type || '').toString().toLowerCase().indexOf('outbound') >= 0;
  const dirWord = isOutbound ? 'verso' : 'da';
  const dirField = isOutbound ? 'A' : 'Da';
  const callStartedAt = call.createdAt || new Date().toISOString();
  const durationSec = msg.durationSeconds || msg.duration || 0;
  const endedReason = msg.endedReason || 'unknown';

  let summary = msg.summary || (msg.analysis && msg.analysis.summary) || '';
  if (!summary && msg.analysis && msg.analysis.structuredData) {
    summary = formatStructuredData(msg.analysis.structuredData);
  }
  if (!summary) {
    summary = '(nessun riassunto — verifica Analysis Plan / Structured Output in Vapi)';
  }

  let transcript = '';
  if (typeof msg.transcript === 'string' && msg.transcript.trim().length > 0) {
    transcript = msg.transcript;
  } else if (msg.artifact && typeof msg.artifact.transcript === 'string' && msg.artifact.transcript.trim().length > 0) {
    transcript = msg.artifact.transcript;
  } else if (msg.artifact && Array.isArray(msg.artifact.messages)) {
    transcript = formatTranscript(msg.artifact.messages);
  } else if (Array.isArray(msg.messages)) {
    transcript = formatTranscript(msg.messages);
  } else if (Array.isArray(msg.transcript)) {
    transcript = formatTranscript(msg.transcript);
  } else {
    transcript = '(transcript non disponibile nel payload — verifica Artifact Plan in Vapi)';
  }

  let recordingUrl = msg.recordingUrl || (msg.artifact && msg.artifact.recordingUrl) || '';
  if (typeof recordingUrl !== 'string' || !recordingUrl.startsWith('http')) {
    recordingUrl = '';
  }

  const dateLabel = Utilities.formatDate(new Date(callStartedAt), TIMEZONE, 'dd/MM/yyyy HH:mm');

  // 1) Notifica push immediata
  const pushText = 'Chiamata ' + dirWord + ' ' + callerPhone + ' alle ' + dateLabel +
                   ' (' + Math.round(durationSec) + ' sec)\n\n' +
                   summary +
                   '\n\nTranscript nella mail in Inbox.';
  sendPush(pushText, 'Chiamata gestita', {
    priority: 'high',
    click: 'https://mail.google.com/mail/u/0/#inbox'
  });

  // 2) Email vera in Inbox
  const subject = 'Chiamata ' + dirWord + ' ' + callerPhone + ' — ' + dateLabel;
  const htmlBody =
    '<h2>Chiamata gestita dall\'assistente</h2>' +
    '<p><b>' + dirField + ':</b> ' + escapeHtml(callerPhone) + '<br>' +
    '<b>Orario:</b> ' + escapeHtml(dateLabel) + '<br>' +
    '<b>Durata:</b> ' + Math.round(durationSec) + ' secondi<br>' +
    '<b>Motivo fine chiamata:</b> ' + escapeHtml(endedReason) + '</p>' +
    '<h3>Riassunto</h3><p>' + escapeHtml(summary).replace(/\n/g, '<br>') + '</p>' +
    (recordingUrl ? '<p><a href="' + recordingUrl + '">Ascolta registrazione</a></p>' : '') +
    '<h3>Transcript</h3><pre style="white-space: pre-wrap; font-family: monospace; font-size: 13px;">' + escapeHtml(transcript) + '</pre>';

  GmailApp.sendEmail(OWNER_EMAIL, subject, transcript, {
    htmlBody: htmlBody,
    name: 'Assistente personale'
  });

  return jsonOut({ ok: true, notified: true }, 200);
}

// ====================================================================
//  ACTION: get_secretary_info
// ====================================================================

function getSecretaryInfoEndpoint() {
  const drafts = GmailApp.getDrafts();
  for (const d of drafts) {
    const msg = d.getMessage();
    const subj = msg.getSubject() || '';
    if (subj.startsWith('[Info Segreteria]')) {
      return jsonOut({
        has_info: true,
        info: msg.getPlainBody().trim(),
        updated_at: msg.getDate().toISOString()
      }, 200);
    }
  }
  return jsonOut({ has_info: false }, 200);
}

function formatTranscript(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return '(transcript vuoto)';
  return messages.map(m => {
    const role = (m.role || 'unknown').toUpperCase();
    const text = m.message || m.content || m.text || '';
    const ts = m.time || m.secondsFromStart;
    return '[' + role + (ts !== undefined ? ' @ ' + ts + 's' : '') + ']\n' + text;
  }).join('\n\n');
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ====================================================================
//  HELPERS
// ====================================================================

function todayISO() {
  return Utilities.formatDate(new Date(), TIMEZONE, 'yyyy-MM-dd');
}
function addDaysISO(isoStr, days) {
  const d = parseDateISO(isoStr);
  d.setDate(d.getDate() + days);
  return Utilities.formatDate(d, TIMEZONE, 'yyyy-MM-dd');
}
function parseDateISO(isoStr) {
  const parts = isoStr.split('-').map(n => parseInt(n, 10));
  const d = new Date();
  d.setFullYear(parts[0], parts[1] - 1, parts[2]);
  d.setHours(0, 0, 0, 0);
  return d;
}

function isBlockingEvent(ev) {
  if (ev.isAllDayEvent()) return false;
  try {
    if (ev.getMyStatus() === CalendarApp.GuestStatus.NO) return false;
  } catch (e) { /* eventi non-invitati: ignora */ }
  return true;
}

// ====================================================================
//  TEST FUNCTIONS (eseguibili dall'editor)
// ====================================================================

function testCheckAvailabilityNext3Days() {
  const today = todayISO();
  const in3 = addDaysISO(today, 3);
  const fake = { parameter: { token: secret('VAPI_GATEWAY_TOKEN'), action: 'check_availability', date_from: today, date_to: in3, duration_min: 30 } };
  console.log(doGet(fake).getContent());
}

function testBookAppointment() {
  const fake = {
    parameter: { token: secret('VAPI_GATEWAY_TOKEN'), action: 'book_appointment' },
    postData: { contents: JSON.stringify({
      slot_start: '2026-05-18T13:00:00+02:00',
      duration_min: 30,
      caller_name: 'Mario Rossi',
      caller_phone: '+393331234567',
      reason: 'caffe di prova'
    })}
  };
  console.log(doPost(fake).getContent());
}

function testEndOfCall() {
  const fake = {
    parameter: { token: secret('VAPI_GATEWAY_TOKEN'), action: 'end_of_call' },
    postData: { contents: JSON.stringify({
      message: {
        type: 'end-of-call-report',
        call: { customer: { number: '+393331234567' }, createdAt: new Date().toISOString() },
        durationSeconds: 87,
        endedReason: 'customer-ended-call',
        summary: 'Mario Rossi voleva fissare un caffe. Slot tentativo 18/05 alle 13:00.',
        transcript: [
          { role: 'assistant', message: 'Pronto, sono l\'assistente.' },
          { role: 'user', message: 'Ciao, sono Mario.' }
        ]
      }
    })}
  };
  console.log(doPost(fake).getContent());
}

// ====================================================================
//  STATUS-UPDATE: triggera la notifica live a inizio chiamata
// ====================================================================

function statusUpdate(params, body) {
  const msg = (body && body.message) || body;
  if ((msg.type || '') !== 'status-update') {
    return jsonOut({ ok: true, ignored: true }, 200);
  }
  const call = msg.call || {};
  const status = msg.status || call.status || '';
  if (status !== 'in-progress') {
    return jsonOut({ ok: true, ignored: true, status: status }, 200);
  }

  const customer = call.customer || {};
  const otherPhone = customer.number || msg.phoneNumber || '';
  const callId = call.id || msg.callId || '';
  if (!callId) {
    console.warn('statusUpdate: nessun callId');
    return jsonOut({ ok: true, no_call_id: true }, 200);
  }

  const isOutbound = (call.type || '').toString().toLowerCase().indexOf('outbound') >= 0;

  // FILTRO WHITELIST: SOLO per le chiamate inbound.
  // Le outbound sono volute dal titolare: il numero e' la destinazione.
  if (!isOutbound) {
    if (!otherPhone || !isInWhitelist(otherPhone)) {
      console.log('Hangup automatico per ' + (otherPhone || 'numero anonimo') + ' (non in whitelist)');
      const monResp = JSON.parse(getMonitor({ callId: callId }).getContent());
      if (monResp.controlUrl) {
        try {
          UrlFetchApp.fetch(monResp.controlUrl, {
            method: 'POST',
            contentType: 'application/json',
            payload: JSON.stringify({
              type: 'say',
              message: 'Mi dispiace, in questo momento non possiamo gestire la sua chiamata. Riprovi piu\' tardi. Grazie.',
              endCallAfterSpoken: true
            }),
            muteHttpExceptions: true
          });
        } catch (e) { console.error('Hangup-after-say failed: ' + e); }
      }
      sendPush('Bloccata chiamata da ' + (otherPhone || 'numero anonimo'),
               'Chiamata filtrata', { priority: 'low' });
      return jsonOut({ ok: true, rejected: true, reason: 'not_in_whitelist' }, 200);
    }
  }

  // Notifica live view — link SENZA token (auth = login Google sul deployment UI)
  const liveUrl = WEBAPP_UI_URL + '?action=live_view&callId=' + encodeURIComponent(callId);
  const titolo = isOutbound
    ? ('Chiamata in uscita verso ' + otherPhone)
    : ('Chiamata in arrivo da ' + otherPhone);
  sendPush('Tocca per ascoltare e intervenire', titolo,
           { priority: 'urgent', click: liveUrl });

  return jsonOut({ ok: true, notified: true }, 200);
}

// ====================================================================
//  LIVE VIEW: serve la pagina HTML (auth: login Google del titolare)
// ====================================================================

function liveViewPage(params) {
  const callId = params.callId || '';
  if (!callId) {
    return HtmlService.createHtmlOutput('<h1>callId mancante</h1>');
  }
  const t = HtmlService.createTemplateFromFile('LiveCall');
  t.callId = callId;
  t.uiToken = mintUiToken();      // token a vita breve per le AJAX della pagina
  t.apiUrl = WEBAPP_API_URL;      // le AJAX vanno sul deployment API
  return t.evaluate()
    .setTitle('Live call ' + callId.substring(0, 8))
    .setSandboxMode(HtmlService.SandboxMode.IFRAME)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// ====================================================================
//  GET MONITOR: ritorna listenUrl + controlUrl + caller info
// ====================================================================

function getMonitor(params) {
  const callId = params.callId || '';
  if (!callId) return jsonOut({ error: 'callId mancante' }, 400);

  const resp = UrlFetchApp.fetch(VAPI_API + '/call/' + encodeURIComponent(callId), {
    method: 'GET',
    headers: { 'Authorization': 'Bearer ' + secret('VAPI_PRIVATE_KEY') },
    muteHttpExceptions: true
  });
  const code = resp.getResponseCode();
  if (code !== 200) {
    return jsonOut({ error: 'vapi_get_call_failed', code: code, body: resp.getContentText().substring(0, 300) }, 502);
  }
  const call = JSON.parse(resp.getContentText());

  const monitor = call.monitor || {};
  const transport = call.transport || {};
  const listenUrl = monitor.listenUrl || transport.listenUrl || call.listenUrl || '';
  const controlUrl = monitor.controlUrl || transport.controlUrl || call.controlUrl || '';

  return jsonOut({
    callId: callId,
    listenUrl: listenUrl,
    controlUrl: controlUrl,
    callerNumber: (call.customer && call.customer.number) || '',
    startedAt: call.startedAt || call.createdAt || '',
    status: call.status || ''
  }, 200);
}

// ====================================================================
//  SAY — controlUrl + {type:'say', message}
// ====================================================================

function sendSay(params, body) {
  const callId = params.callId || (body && body.callId) || '';
  const message = (body && body.message) || '';
  if (!callId || !message) return jsonOut({ error: 'callId o message mancante' }, 400);

  const mon = JSON.parse(getMonitor({ callId: callId }).getContent());
  if (!mon.controlUrl) return jsonOut({ error: 'controlUrl non disponibile' }, 502);

  const resp = UrlFetchApp.fetch(mon.controlUrl, {
    method: 'POST',
    contentType: 'application/json',
    payload: JSON.stringify({ type: 'say', message: message }),
    muteHttpExceptions: true
  });
  const code = resp.getResponseCode();
  return jsonOut({ ok: code >= 200 && code < 300, code: code, vapi_response: resp.getContentText().substring(0, 200) }, 200);
}

// ====================================================================
//  BACKGROUND MESSAGE — via controlUrl (add-message)
// ====================================================================

function sendBackgroundMessage(params, body) {
  const callId = params.callId || (body && body.callId) || '';
  const content = (body && body.content) || '';
  if (!callId || !content) return jsonOut({ error: 'callId o content mancante' }, 400);

  const mon = JSON.parse(getMonitor({ callId: callId }).getContent());
  if (!mon.controlUrl) return jsonOut({ error: 'controlUrl non disponibile' }, 502);

  const text = '[ISTRUZIONE OPERATORE — PRIORITA\' MASSIMA, ESEGUI NELLA PROSSIMA RISPOSTA] ' + content;
  const attempts = [
    { type: 'add-message', message: { role: 'system', content: text }, triggerResponseEnabled: true },
    { type: 'add-message', message: { role: 'system', content: text } }
  ];

  const results = [];
  for (const payload of attempts) {
    const resp = UrlFetchApp.fetch(mon.controlUrl, {
      method: 'POST',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
    const code = resp.getResponseCode();
    results.push({ code: code, body: resp.getContentText().substring(0, 150) });
    if (code >= 200 && code < 300) {
      return jsonOut({ ok: true, worked: JSON.stringify(payload), code: code }, 200);
    }
  }
  return jsonOut({ ok: false, attempts: results }, 200);
}

// ====================================================================
//  HANGUP — chiusura chiamata ATTIVA via controlUrl
// ====================================================================

function sendHangup(params, body) {
  const callId = params.callId || (body && body.callId) || '';
  if (!callId) return jsonOut({ error: 'callId mancante' }, 400);

  const mon = JSON.parse(getMonitor({ callId: callId }).getContent());
  if (!mon.controlUrl) return jsonOut({ error: 'controlUrl non disponibile' }, 502);

  const attempts = [
    { type: 'end-call' },
    { type: 'hangup' },
    { type: 'control', control: 'hang-up' }
  ];

  const results = [];
  for (const payload of attempts) {
    const resp = UrlFetchApp.fetch(mon.controlUrl, {
      method: 'POST',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
    const code = resp.getResponseCode();
    results.push({ payload: JSON.stringify(payload), code: code, body: resp.getContentText().substring(0, 150) });
    if (code >= 200 && code < 300) {
      return jsonOut({ ok: true, worked: JSON.stringify(payload), code: code }, 200);
    }
  }
  return jsonOut({ ok: false, attempts: results }, 200);
}

// ====================================================================
//  CONVERSATION-UPDATE: salva conversazione in cache per polling browser
// ====================================================================

function handleConversationUpdate(body) {
  const msg = (body && body.message) || body;
  const call = msg.call || {};
  const callId = call.id || msg.callId || '';
  if (!callId) return jsonOut({ ok: true, no_call_id: true }, 200);

  const conv = msg.conversation ||
               msg.messages ||
               (msg.artifact && msg.artifact.messages) ||
               [];

  CacheService.getScriptCache().put('conv:' + callId, JSON.stringify(conv), 3600);
  return jsonOut({ ok: true, saved: conv.length }, 200);
}

function getTranscriptEndpoint(params) {
  const callId = params.callId || '';
  if (!callId) return jsonOut({ error: 'callId mancante' }, 400);
  const raw = CacheService.getScriptCache().get('conv:' + callId);
  return jsonOut({ conversation: raw ? JSON.parse(raw) : [] }, 200);
}

function formatStructuredData(sd) {
  if (!sd || typeof sd !== 'object') return '';
  const copy = JSON.parse(JSON.stringify(sd));
  const lines = [];
  const preferred = ['summary', 'riassunto', 'riepilogo', 'overview', 'sintesi'];
  for (const k of preferred) {
    if (copy[k]) {
      lines.push(String(copy[k]));
      delete copy[k];
    }
  }
  for (const k in copy) {
    const v = copy[k];
    if (v === null || v === undefined || v === '') continue;
    const fv = typeof v === 'object' ? JSON.stringify(v) : String(v);
    lines.push(k + ': ' + fv);
  }
  return lines.join('\n');
}

// ====================================================================
//  OUTBOUND — console HTML (auth: login Google del titolare)
// ====================================================================

function outboundConsolePage(params) {
  const t = HtmlService.createTemplateFromFile('OutboundConsole');
  t.uiToken = mintUiToken();
  t.apiUrl = WEBAPP_API_URL;
  t.uiUrl = WEBAPP_UI_URL;   // per costruire il link a live_view (pagina sul deployment UI)
  return t.evaluate()
    .setTitle('Console chiamate')
    .setSandboxMode(HtmlService.SandboxMode.IFRAME)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// ====================================================================
//  OUTBOUND — dialogo Gemini per preparare il prompt della chiamata
// ====================================================================

function geminiChat(params, body) {
  const history = (body && body.history) || [];
  if (!Array.isArray(history) || history.length === 0) {
    return jsonOut({ error: 'history mancante' }, 400);
  }

  const oggiNum = Utilities.formatDate(new Date(), TIMEZONE, 'd/MM/yyyy');

  const metaPrompt =
    'Sei l\'assistente di Andrea Braschi e PREPARI una telefonata in uscita eseguita poi da un agente vocale AI.\n\n' +
    'Oggi è il ' + oggiNum + '.\n\n' +
    'PRINCIPIO GUIDA — efficienza: arriva al risultato col minimo numero di scambi. Flusso ideale: Andrea descrive la telefonata → tu fai UN SOLO messaggio che chiede in blocco TUTTO cio che ti manca → Andrea risponde → tu produci il blocco JSON. Niente terzo scambio se evitabile.\n\n' +
    'COME PROCEDI:\n' +
    '1. Leggi il messaggio di Andrea ed estrai SUBITO tutto cio che ha gia detto.\n' +
    '2. Se ti mancano informazioni, chiedile TUTTE INSIEME in un unico messaggio, come elenco numerato. Pensa in anticipo a OGNI cosa che ti serve per preparare bene la telefonata (per una prenotazione tipicamente: giorno, ora, numero di persone, nome per la prenotazione, eventuali preferenze o vincoli, cosa fare se non c\'e posto). NON lasciare nulla per un secondo giro.\n' +
    '3. Se gia dal primo messaggio di Andrea hai abbastanza per preparare una telefonata ragionevole, NON fare domande: vai dritto al blocco JSON.\n' +
    '4. Dopo la risposta di Andrea produci il blocco JSON. Fai un altro giro di domande SOLO se una risposta e davvero mancante, ambigua o contraddittoria — e anche allora chiedi tutto il resto in un colpo solo.\n' +
    '5. Il blocco JSON: rispondi ESCLUSIVAMENTE con esso, senza testo prima o dopo, in questo formato esatto:\n' +
    '{"ready": true, "first_message": "...", "system_prompt": "..."}\n\n' +
    'first_message = prima frase che l\'agente dice quando gli rispondono.\n' +
    'system_prompt = istruzioni complete per l\'agente: chi è, perché chiama, tutti i dati raccolti, come gestire le risposte dell\'interlocutore, quando concludere.\n\n' +
    'NON chiedere MAI ad Andrea il numero di telefono da chiamare: è già fornito in un campo dedicato della console, non ti serve.\n\n' +
    'Nel system_prompt: l\'agente parla in italiano in prima persona come Andrea Braschi; se gli chiedono esplicitamente se è un assistente/segreteria/sistema automatico NON lo nega; per contesti sensibili (medico, sanità, banca, PA) si presenta come "assistente di Andrea"; non fornisce dati di pagamento.\n\n' +
    'REGOLE SULLE DATE (includile SEMPRE nel system_prompt quando la chiamata riguarda prenotazioni o appuntamenti):\n' +
    '- L\'agente non deve MAI chiedere l\'anno: nessuno prenota indicando l\'anno. E nemmeno tu lo chiedi ad Andrea.\n' +
    '- Le date si intendono nell\'anno corrente; se la data risulta già passata rispetto a oggi (' + oggiNum + '), si intende l\'anno successivo. L\'anno lo calcola l\'agente.\n' +
    '- Quando l\'agente pronuncia una data dice SOLO giorno e mese (es. "sabato 24 maggio"), MAI l\'anno.\n' +
    '- Scrivi sempre nel system_prompt la data odierna (' + oggiNum + ') così l\'agente sa interpretare "oggi", "domani", "questo weekend".\n\n' +
    'Finché non sei pronto rispondi in italiano col tuo unico messaggio di domande (senza JSON).';

  let convText = '\n\n--- CONVERSAZIONE FINORA ---\n';
  for (const m of history) {
    convText += (m.role === 'assistant' ? 'TU' : 'ANDREA') + ': ' + String(m.content || '') + '\n';
  }
  convText += '--- FINE ---\n\nGenera ORA la tua prossima risposta (un unico messaggio di domande, oppure il blocco JSON se hai tutte le info):';

  const responseText = callGemini(metaPrompt + convText, 2048);
  if (!responseText) return jsonOut({ error: 'gemini_no_response' }, 502);

  const m = responseText.match(/\{[\s\S]*"ready"[\s\S]*\}/);
  if (m) {
    try {
      const parsed = JSON.parse(m[0]);
      if (parsed.ready && parsed.system_prompt && parsed.first_message) {
        return jsonOut({ ready: true, first_message: parsed.first_message, system_prompt: parsed.system_prompt }, 200);
      }
    } catch (e) { /* non era JSON valido → trattalo come domanda */ }
  }
  return jsonOut({ ready: false, question: responseText }, 200);
}

// ====================================================================
//  OUTBOUND — avvia la chiamata Vapi
//  Riusa l'assistente inbound via assistantId: voce, transcriber,
//  backgroundSound e analysisPlan IDENTICI all'inbound. Sovrascrive
//  solo cio che e' specifico dell'outbound.
// ====================================================================

function startOutboundCall(params, body) {
  const toNumber = (body && body.to_number) || '';
  const firstMessage = (body && body.first_message) || '';
  const systemPrompt = (body && body.system_prompt) || '';
  if (!toNumber || !firstMessage || !systemPrompt) {
    return jsonOut({ error: 'to_number, first_message o system_prompt mancante' }, 400);
  }

  const payload = {
    phoneNumberId: VAPI_PHONE_NUMBER_ID,
    customer: { number: toNumber },
    assistantId: INBOUND_ASSISTANT_ID,
    assistantOverrides: {
      firstMessage: firstMessage,
      firstMessageMode: 'assistant-speaks-first',
      model: {
        provider: 'openai',
        model: 'gpt-4o',
        temperature: 0.4,
        messages: [{ role: 'system', content: systemPrompt }]
      },
      server: { url: WEBAPP_API_URL + '?token=' + encodeURIComponent(secret('VAPI_GATEWAY_TOKEN')) + '&action=vapi_event' },
      serverMessages: ['status-update', 'conversation-update', 'end-of-call-report'],
      monitorPlan: { listenEnabled: true, controlEnabled: true }
    }
  };

  const resp = UrlFetchApp.fetch(VAPI_API + '/call', {
    method: 'POST',
    contentType: 'application/json',
    headers: { 'Authorization': 'Bearer ' + secret('VAPI_PRIVATE_KEY') },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
  const code = resp.getResponseCode();
  const respBody = resp.getContentText();
  if (code !== 200 && code !== 201) {
    return jsonOut({ ok: false, code: code, vapi_response: respBody.substring(0, 400) }, 200);
  }
  let callId = '';
  try { callId = JSON.parse(respBody).id || ''; } catch (e) {}
  return jsonOut({ ok: true, callId: callId }, 200);
}

function printConsoleUrls() {
  console.log('Console outbound (apri loggato col tuo Google):\n' +
              WEBAPP_UI_URL + '?action=outbound_console');
}

function testGeminiChat() {
  const fake = { history: [{ role: 'user', content: 'Chiama la pizzeria Amalfitana e prenota un tavolo per stasera' }] };
  const t0 = Date.now();
  const result = geminiChat({}, fake);
  console.log('Durata: ' + (Date.now() - t0) + ' ms');
  console.log('Risposta: ' + result.getContent());
}

// ====================================================================
//  TEST OUTBOUND — chiamata in uscita diretta, senza Gemini ne console
// ====================================================================

function testOutboundCall() {
  var TEST_TARGET_NUMBER = '+39XXXXXXXXXX';   // il tuo cellulare
  var TEST_FIRST_MESSAGE = 'Buongiorno, la chiamo solo per una breve prova tecnica della linea. Mi sente bene?';
  var oggi = Utilities.formatDate(new Date(), TIMEZONE, 'd/MM/yyyy');
  var TEST_SYSTEM_PROMPT =
    'Stai facendo una chiamata di PROVA TECNICA per conto di Andrea. ' +
    'Parla SEMPRE e SOLO in italiano, tono naturale, frasi brevi. ' +
    'Oggi è il ' + oggi + '. Quando pronunci una data di\' solo giorno e mese, mai l\'anno. ' +
    'Saluta, chiedi se ti sentono bene, di\' una frase di cortesia, ringrazia e CHIUDI la chiamata. ' +
    'Tieni la chiamata sotto i 30 secondi. Non prendere appuntamenti.';

  var payload = {
    phoneNumberId: VAPI_PHONE_NUMBER_ID,
    customer: { number: TEST_TARGET_NUMBER },
    assistantId: INBOUND_ASSISTANT_ID,
    assistantOverrides: {
      firstMessage: TEST_FIRST_MESSAGE,
      firstMessageMode: 'assistant-speaks-first',
      endCallFunctionEnabled: true,
      maxDurationSeconds: 120,
      model: {
        provider: 'openai',
        model: 'gpt-4o',
        temperature: 0.3,
        messages: [{ role: 'system', content: TEST_SYSTEM_PROMPT }]
      }
    }
  };

  var resp = UrlFetchApp.fetch(VAPI_API + '/call', {
    method: 'POST',
    contentType: 'application/json',
    headers: { 'Authorization': 'Bearer ' + secret('VAPI_PRIVATE_KEY') },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  var code = resp.getResponseCode();
  var text = resp.getContentText();
  console.log('POST /call -> HTTP ' + code);
  if (code !== 200 && code !== 201) { console.error('Creazione chiamata fallita:\n' + text); return; }

  var call = JSON.parse(text);
  var callId = call.id;
  console.log('Chiamata creata. id=' + callId + ' status=' + call.status);

  for (var i = 0; i < 30; i++) {
    Utilities.sleep(5000);
    var poll = UrlFetchApp.fetch(VAPI_API + '/call/' + callId, {
      method: 'GET',
      headers: { 'Authorization': 'Bearer ' + secret('VAPI_PRIVATE_KEY') },
      muteHttpExceptions: true
    });
    if (poll.getResponseCode() !== 200) continue;
    var c = JSON.parse(poll.getContentText());
    console.log('  [' + ((i + 1) * 5) + 's] status=' + c.status +
                (c.endedReason ? ' endedReason=' + c.endedReason : ''));
    if (c.status === 'ended') {
      console.log('=== ESITO === endedReason: ' + (c.endedReason || ''));
      console.log('Summary: ' + (c.analysis && c.analysis.summary ? c.analysis.summary : '(nessuno)'));
      return;
    }
  }
  console.warn('Timeout polling: controlla in Vapi -> Calls (id ' + callId + ').');
}
