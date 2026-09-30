import 'dotenv/config';

function clean(value) {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : undefined;
}

export const BOT_TOKEN = clean(process.env.BOT_TOKEN);

// Base da API do MLBB. Configurável por env para apontar, por exemplo,
// para a sua própria API hospedada na Railway.
export const API_BASE = (clean(process.env.MLBB_API_URL) || 'https://arena.rone.dev/api').replace(/\/+$/, '');

export const API_TIMEOUT_MS = Number(clean(process.env.API_TIMEOUT_MS) || 12000);
export const API_RETRIES = Number(clean(process.env.API_RETRIES) || 2);

// Railway define PORT. O servidor HTTP existe só para o healthcheck.
export const PORT = Number(clean(process.env.PORT) || 3000);

// Persistência das sessões.
// Em Railway sem volume, o disco é efêmero: as sessões somem a cada deploy.
// Monte um volume e a variável RAILWAY_VOLUME_MOUNT_PATH é usada automaticamente.
export const VOLUME_PATH = clean(process.env.RAILWAY_VOLUME_MOUNT_PATH);
export const SESSION_FILE =
  clean(process.env.SESSION_FILE) || `${VOLUME_PATH || './data'}/sessions.json`;
export const HAS_PERSISTENT_DISK = Boolean(clean(process.env.SESSION_FILE) || VOLUME_PATH);

// Webhook (opcional). Se WEBHOOK_URL estiver definido, o bot roda em modo webhook
// em vez de long polling. Na Railway use RAILWAY_PUBLIC_DOMAIN.
const railwayDomain = clean(process.env.RAILWAY_PUBLIC_DOMAIN);
export const WEBHOOK_URL =
  clean(process.env.WEBHOOK_URL) || (clean(process.env.USE_WEBHOOK) === 'true' && railwayDomain
    ? `https://${railwayDomain}`
    : undefined);
export const WEBHOOK_SECRET = clean(process.env.TELEGRAM_WEBHOOK_SECRET);
export const WEBHOOK_PATH = clean(process.env.WEBHOOK_PATH) || '/telegram/webhook';

// Sessão de cadastro expira para não vazar memória nem travar o usuário.
export const REGISTRATION_TTL_MS = Number(clean(process.env.REGISTRATION_TTL_MS) || 10 * 60 * 1000);
