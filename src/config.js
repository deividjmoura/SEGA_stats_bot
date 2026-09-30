import 'dotenv/config';

function clean(value) {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : undefined;
}

export const BOT_TOKEN = clean(process.env.BOT_TOKEN);

/**
 * Hosts da Rone Arena API, em ordem de preferência.
 * Os dois são gratuitos e servem exatamente os mesmos endpoints; o segundo é o
 * host "high volume" e serve de reserva quando o primeiro bloqueia ou cai.
 * MLBB_API_URL sobrescreve a lista (aceita várias URLs separadas por vírgula).
 */
const DEFAULT_API_BASES = ['https://arena.rone.dev/api', 'https://arena-hv.fastapicloud.dev/api'];

export const API_BASES = (clean(process.env.MLBB_API_URL)?.split(',') ?? DEFAULT_API_BASES)
  .map((url) => url.trim().replace(/\/+$/, ''))
  .filter(Boolean);

/**
 * A API fica atrás de um WAF que rejeita clientes sem cara de navegador.
 * O fetch do Node manda `User-Agent: node`, o que costuma levar bloqueio
 * silencioso (resposta HTML em vez de JSON) — por isso mandamos headers reais.
 */
export const DEFAULT_HEADERS = {
  'User-Agent':
    clean(process.env.API_USER_AGENT) ||
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
  Origin: 'https://arena.rone.dev',
  Referer: 'https://arena.rone.dev/web/user'
};

// A API só aceita estes códigos de idioma. `pt_BR` devolve 422.
export const API_LANG = 'pt';

export const API_TIMEOUT_MS = Number(clean(process.env.API_TIMEOUT_MS) || 30000);
export const API_RETRIES = Number(clean(process.env.API_RETRIES) || 2);

// Railway define PORT. O servidor HTTP existe para o healthcheck.
export const PORT = Number(clean(process.env.PORT) || 3000);

// Persistência. Com um Volume na Railway, RAILWAY_VOLUME_MOUNT_PATH é usada sozinha.
export const VOLUME_PATH = clean(process.env.RAILWAY_VOLUME_MOUNT_PATH);
export const SESSION_FILE =
  clean(process.env.SESSION_FILE) || `${VOLUME_PATH || './data'}/sessions.json`;
export const HAS_PERSISTENT_DISK = Boolean(clean(process.env.SESSION_FILE) || VOLUME_PATH);

// Webhook opcional. O padrão (long polling) funciona sem domínio.
const railwayDomain = clean(process.env.RAILWAY_PUBLIC_DOMAIN);
export const WEBHOOK_URL =
  clean(process.env.WEBHOOK_URL) ||
  (clean(process.env.USE_WEBHOOK) === 'true' && railwayDomain ? `https://${railwayDomain}` : undefined);
export const WEBHOOK_SECRET = clean(process.env.TELEGRAM_WEBHOOK_SECRET);
export const WEBHOOK_PATH = clean(process.env.WEBHOOK_PATH) || '/telegram/webhook';

export const REGISTRATION_TTL_MS = Number(clean(process.env.REGISTRATION_TTL_MS) || 10 * 60 * 1000);

// Telegram ID do dono, para liberar o /diag. Opcional.
export const ADMIN_ID = Number(clean(process.env.ADMIN_TELEGRAM_ID) || 0);
