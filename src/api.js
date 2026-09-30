import { API_BASE, API_TIMEOUT_MS, API_RETRIES } from './config.js';

const RETRIABLE_STATUS = new Set([429, 500, 502, 503, 504]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * fetch com timeout + retry para erros de rede/5xx.
 * Nunca lança por status HTTP: devolve sempre a Response.
 */
export async function apiFetch(path, options = {}) {
  const url = API_BASE + path;
  let lastError = null;

  for (let attempt = 0; attempt <= API_RETRIES; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      if (RETRIABLE_STATUS.has(response.status) && attempt < API_RETRIES) {
        await sleep(400 * (attempt + 1));
        continue;
      }
      return response;
    } catch (error) {
      lastError = error;
      if (attempt < API_RETRIES) {
        await sleep(400 * (attempt + 1));
        continue;
      }
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError || new Error('Falha desconhecida ao chamar a API.');
}

/**
 * Sempre devolve { ok, status, body, error } — nunca lança.
 * Isso evita que um erro de rede derrube um handler inteiro.
 */
export async function apiJson(path, options = {}) {
  try {
    const response = await apiFetch(path, options);
    const body = await response.json().catch(() => ({}));
    const code = body?.code;
    const codeOk = code === undefined || Number(code) === 0;
    return {
      ok: response.ok && codeOk,
      status: response.status,
      unauthorized: response.status === 401 || response.status === 403,
      body,
      message: body?.msg || body?.message || body?.detail || '',
      error: null
    };
  } catch (error) {
    const aborted = error?.name === 'AbortError';
    return {
      ok: false,
      status: 0,
      unauthorized: false,
      body: {},
      message: aborted ? 'Tempo limite excedido ao falar com a API.' : 'Não foi possível conectar à API.',
      error
    };
  }
}

export function authHeaders(jwt) {
  return { Authorization: `Bearer ${jwt}` };
}

export const jsonHeaders = { 'Content-Type': 'application/json' };
