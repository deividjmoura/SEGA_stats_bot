import { API_BASES, API_TIMEOUT_MS, API_RETRIES, DEFAULT_HEADERS, API_LANG } from './config.js';

const RETRIABLE_STATUS = new Set([429, 500, 502, 503, 504]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Host atualmente saudável. Se um host falha, o próximo assume e vira o padrão. */
let preferredBase = 0;

export function currentBase() {
  return API_BASES[preferredBase];
}

/** Garante que toda rota leve `lang=pt` (a API rejeita pt_BR e outros formatos). */
function withLang(path) {
  if (path.includes('lang=')) return path;
  return path + (path.includes('?') ? '&' : '?') + `lang=${API_LANG}`;
}

/**
 * Executa a requisição contra um host específico.
 * Nunca lança por status HTTP; lança só em erro de rede/timeout.
 */
async function requestOnce(base, path, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  try {
    const response = await fetch(base + path, {
      ...options,
      headers: { ...DEFAULT_HEADERS, ...(options.headers || {}) },
      signal: controller.signal,
      redirect: 'follow'
    });

    const text = await response.text();
    const contentType = response.headers.get('content-type') || '';

    let body = null;
    let parseError = null;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch (error) {
        parseError = error;
      }
    }

    return { response, body, text, contentType, parseError };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Chama a API com:
 *  - retry em erro de rede e em 429/5xx (nunca em 4xx, que não melhora repetindo)
 *  - failover entre os hosts configurados
 *  - diagnóstico completo do que voltou, inclusive respostas que não são JSON
 *
 * Retorna sempre um objeto — nunca lança.
 */
export async function apiJson(path, options = {}) {
  const fullPath = withLang(path);
  const attemptsLog = [];
  let last = null;

  // Começa pelo host preferido e, se preciso, roda a lista inteira.
  for (let hostOffset = 0; hostOffset < API_BASES.length; hostOffset += 1) {
    const baseIndex = (preferredBase + hostOffset) % API_BASES.length;
    const base = API_BASES[baseIndex];

    for (let attempt = 0; attempt <= API_RETRIES; attempt += 1) {
      let result;
      try {
        result = await requestOnce(base, fullPath, options);
      } catch (error) {
        const aborted = error?.name === 'AbortError';
        attemptsLog.push(`${base} → ${aborted ? 'timeout' : `rede: ${error.message}`}`);
        last = {
          ok: false,
          status: 0,
          unauthorized: false,
          body: {},
          message: aborted
            ? `A API não respondeu em ${Math.round(API_TIMEOUT_MS / 1000)}s.`
            : 'Não foi possível conectar à API.',
          diagnostic: attemptsLog.join(' | ')
        };
        if (attempt < API_RETRIES) {
          await sleep(500 * (attempt + 1));
          continue;
        }
        break; // próximo host
      }

      const { response, body, text, contentType, parseError } = result;
      const status = response.status;

      // Resposta que não é JSON = quase sempre bloqueio de WAF/Cloudflare
      // ou página de erro do proxy. Vale trocar de host.
      if (parseError || body === null) {
        const snippet = text.replace(/\s+/g, ' ').slice(0, 120);
        attemptsLog.push(`${base} → HTTP ${status} não-JSON (${contentType || 'sem content-type'})`);
        last = {
          ok: false,
          status,
          unauthorized: false,
          body: {},
          message: `A API respondeu HTTP ${status} em formato inesperado (${contentType || 'desconhecido'}). ${snippet}`,
          diagnostic: attemptsLog.join(' | ')
        };
        break; // não adianta repetir no mesmo host
      }

      const code = body?.code;
      const codeOk = code === undefined || Number(code) === 0;
      const message = body?.msg || body?.message || formatDetail(body?.detail) || '';

      if (response.ok && codeOk) {
        preferredBase = baseIndex; // esse host está bom, fica como padrão
        return { ok: true, status, unauthorized: false, body, message, diagnostic: null };
      }

      attemptsLog.push(`${base} → HTTP ${status} code=${code ?? '-'} ${message}`.trim());
      last = {
        ok: false,
        status,
        unauthorized: status === 401 || status === 403,
        body,
        message,
        diagnostic: attemptsLog.join(' | ')
      };

      // 401/403 e 422 são definitivos: repetir ou trocar de host não resolve.
      if (last.unauthorized || status === 422) return last;

      if (RETRIABLE_STATUS.has(status) && attempt < API_RETRIES) {
        await sleep(500 * (attempt + 1));
        continue;
      }
      break; // próximo host
    }
  }

  return last;
}

function formatDetail(detail) {
  if (!detail) return '';
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) {
    // Erro de validação do FastAPI: [{loc:[...], msg:"..."}]
    return detail
      .map((item) => {
        const field = Array.isArray(item?.loc) ? item.loc.filter((p) => p !== 'body').join('.') : '';
        return field ? `${field}: ${item?.msg}` : item?.msg;
      })
      .filter(Boolean)
      .join('; ');
  }
  return '';
}

export function authHeaders(jwt) {
  return { Authorization: `Bearer ${jwt}` };
}

export const jsonHeaders = { 'Content-Type': 'application/json' };
