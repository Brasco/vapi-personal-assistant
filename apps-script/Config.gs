// =====================================================================
//  Config.gs — configurazione centralizzata del progetto
// =====================================================================
//  Un solo file, condiviso da Vapi.gs / Recap.gs / WhitelistSync.gs
//  (Apps Script ha scope globale tra i file). Vale per ENTRAMBI i
//  deployment: sono due URL pubblicati dello STESSO progetto.
// =====================================================================

// ---------------------------------------------------------------------
//  CONFIG NON SEGRETA — puo' stare nel codice (e nel repo pubblico)
// ---------------------------------------------------------------------

const TIMEZONE = 'Europe/Rome';
const OWNER_EMAIL = 'youremail@example.com';   // auth delle pagine + destinatario recap/notifiche

// Calendario / appuntamenti
const CALENDAR_ID = 'primary';
const APPOINTMENT_DURATION_MIN_DEFAULT = 30;

// Recap
const GEMINI_MODEL = 'gemini-2.5-flash';
const REPLY_LABEL_NAME = 'To Reply';

// Vapi (ID, non segreti: senza la private key non aprono nulla)
const VAPI_API = 'https://api.vapi.ai';
const VAPI_PHONE_NUMBER_ID = 'REPLACE_WITH_VAPI_PHONE_NUMBER_ID';
const ELEVENLABS_VOICE_ID = 'REPLACE_WITH_ELEVENLABS_VOICE_ID';
const INBOUND_ASSISTANT_ID = 'REPLACE_WITH_INBOUND_ASSISTANT_ID';

// Due deployment dello STESSO progetto:
//  - API: accesso "Anyone", usato da Vapi (webhook + tool)
//  - UI : accesso "Anyone with a Google account", serve le pagine
const WEBAPP_API_URL = 'REPLACE_WITH_WEBAPP_EXEC_URL';
const WEBAPP_UI_URL  = 'INCOLLA_URL_EXEC_DEPLOYMENT_UI';   // il /exec del deployment "Anyone with a Google account"

// Finestre carta-bianca: l'AI propone appuntamenti SOLO qui dentro.
// Formato: { day: 0=Dom..6=Sab, startHour, startMin, endHour, endMin }
const CARTABIANCA_WINDOWS = [
  { day: 1, startHour: 13, startMin: 0, endHour: 14, endMin: 0 },
  { day: 2, startHour: 13, startMin: 0, endHour: 14, endMin: 0 },
  { day: 3, startHour: 13, startMin: 0, endHour: 14, endMin: 0 },
  { day: 4, startHour: 13, startMin: 0, endHour: 14, endMin: 0 },
  { day: 5, startHour: 13, startMin: 0, endHour: 14, endMin: 0 },
  { day: 1, startHour: 19, startMin: 0, endHour: 22, endMin: 0 },
  { day: 2, startHour: 19, startMin: 0, endHour: 22, endMin: 0 },
  { day: 3, startHour: 19, startMin: 0, endHour: 22, endMin: 0 },
  { day: 4, startHour: 19, startMin: 0, endHour: 22, endMin: 0 },
  { day: 5, startHour: 19, startMin: 0, endHour: 22, endMin: 0 },
  { day: 6, startHour: 9, startMin: 0, endHour: 21, endMin: 0 },
  { day: 0, startHour: 9, startMin: 0, endHour: 21, endMin: 0 },
];

// ---------------------------------------------------------------------
//  SEGRETI — NON nel codice. Stanno nelle Script Properties.
// ---------------------------------------------------------------------
//  Impostali UNA volta da: Project Settings -> Script Properties ->
//  Add script property. Chiavi attese:
//    VAPI_GATEWAY_TOKEN   token condiviso col gateway (openssl rand -hex 32)
//    VAPI_PRIVATE_KEY     Vapi -> API Keys -> Private
//    GEMINI_API_KEY       aistudio.google.com/apikey
//    PUSHOVER_TOKEN       API Token dell'Application Pushover
//    PUSHOVER_USER        User Key Pushover
//
//  secret('CHIAVE') legge a runtime; getProperties() legge tutto in una
//  chiamata sola e resta in cache per l'esecuzione.

let _secretsCache = null;
function secret(key) {
  if (!_secretsCache) {
    _secretsCache = PropertiesService.getScriptProperties().getProperties();
  }
  const v = _secretsCache[key];
  if (!v) throw new Error('Script Property mancante: ' + key + ' — impostala in Project Settings.');
  return v;
}
