// ====================================================================
//  WHITELIST SYNC: Google Contacts → PropertiesService
//  Sincronizza i numeri della rubrica Google in una whitelist locale,
//  usata da Vapi.gs (statusUpdate) per far passare all'assistente solo
//  i chiamanti noti. Trigger consigliato: ogni notte alle 03:00.
//
//  Prerequisito: abilitare il servizio avanzato "People API" nel
//  progetto Apps Script (Services + → People API).
// ====================================================================

const WHITELIST_PROP_COUNT = 'whitelist_count';
const WHITELIST_PROP_PREFIX = 'whitelist_';

function syncContactsToWhitelist() {
  const allNumbers = [];
  let pageToken = null;

  do {
    const resp = People.People.Connections.list('people/me', {
      personFields: 'phoneNumbers',
      pageSize: 1000,
      pageToken: pageToken
    });
    if (resp.connections) {
      for (const person of resp.connections) {
        if (person.phoneNumbers) {
          for (const p of person.phoneNumbers) {
            const e164 = normalizeToE164(p.value);
            if (e164) allNumbers.push(e164);
          }
        }
      }
    }
    pageToken = resp.nextPageToken;
  } while (pageToken);

  const whitelist = [...new Set(allNumbers)];
  console.log('Whitelist: ' + whitelist.length + ' numeri unici');

  saveWhitelistChunks(whitelist);
  console.log('Salvata in PropertiesService.');
}

function saveWhitelistChunks(arr) {
  const props = PropertiesService.getScriptProperties();
  // Cancella i vecchi chunk
  const oldCount = parseInt(props.getProperty(WHITELIST_PROP_COUNT) || '0', 10);
  for (let i = 0; i < oldCount; i++) {
    props.deleteProperty(WHITELIST_PROP_PREFIX + i);
  }
  // Apps Script ha un limite di ~9KB per property. Chunk da 200 numeri ~3-4KB
  const CHUNK_SIZE = 200;
  const chunks = [];
  for (let i = 0; i < arr.length; i += CHUNK_SIZE) {
    chunks.push(JSON.stringify(arr.slice(i, i + CHUNK_SIZE)));
  }
  chunks.forEach((c, i) => props.setProperty(WHITELIST_PROP_PREFIX + i, c));
  props.setProperty(WHITELIST_PROP_COUNT, String(chunks.length));
}

function loadWhitelist() {
  const props = PropertiesService.getScriptProperties();
  const count = parseInt(props.getProperty(WHITELIST_PROP_COUNT) || '0', 10);
  let result = [];
  for (let i = 0; i < count; i++) {
    const raw = props.getProperty(WHITELIST_PROP_PREFIX + i);
    if (raw) result = result.concat(JSON.parse(raw));
  }
  return new Set(result);
}

function isInWhitelist(phone) {
  const e164 = normalizeToE164(phone);
  if (!e164) return false;
  return loadWhitelist().has(e164);
}

// Normalizza un numero in formato E.164. ATTENZIONE: i numeri senza
// prefisso internazionale vengono assunti italiani (+39). Adatta questa
// funzione al tuo paese se necessario.
function normalizeToE164(raw) {
  if (!raw) return null;
  let s = String(raw).replace(/[\s().\-]/g, '');
  if (s.startsWith('00')) s = '+' + s.substring(2);
  if (s.startsWith('+')) return s;
  // numero senza prefisso: assume IT (+39)
  if (s.length === 10 && (s.startsWith('3') || s.startsWith('0'))) {
    return '+39' + s;
  }
  return null;
}

// === TEST: esegui manualmente per popolare la whitelist e verificare ===

function testWhitelistFromContacts() {
  syncContactsToWhitelist();
  const wl = loadWhitelist();
  console.log('Caricati: ' + wl.size + ' numeri.');
  console.log('Esempio (primi 10):');
  let i = 0;
  for (const n of wl) {
    if (i++ >= 10) break;
    console.log('  ' + n);
  }
}

function testIsInWhitelist(phone) {
  // Esempio: testIsInWhitelist('+393331234567')
  console.log(phone + ' in whitelist: ' + isInWhitelist(phone));
}
