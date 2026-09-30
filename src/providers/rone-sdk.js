import { createMlbbClient } from 'mlbb-sdk';

const client = createMlbbClient({
  lang: process.env.MLBB_LANG || 'pt',
  timeout: Number(process.env.MLBB_SDK_TIMEOUT_MS || 15000),
  retries: Number(process.env.MLBB_SDK_RETRIES || 1),
  defaultPageSize: 50
});

export function createSdkSession(jwt) {
  if (!jwt) throw new Error('JWT do MLBB não informado.');
  return client.user.createSession(jwt);
}

export async function sdkSendVerificationCode(roleId, zoneId) {
  return client.user.sendVerificationCode(Number(roleId), Number(zoneId));
}

export async function sdkLogin(roleId, zoneId, code) {
  return client.user.login(Number(roleId), Number(zoneId), Number(code));
}

export async function sdkGetInfo(jwt) {
  const session = createSdkSession(jwt);
  return session.getInfo();
}

export async function sdkGetStats(jwt) {
  const session = createSdkSession(jwt);
  return session.getStats();
}

export async function sdkGetSeasons(jwt) {
  const session = createSdkSession(jwt);
  return session.getSeason();
}

export async function sdkGetMatches(jwt, seasonId) {
  const session = createSdkSession(jwt);
  return session.getMatches({ sid: Number(seasonId) });
}

export async function sdkGetMatchDetails(jwt, matchId, seasonId) {
  const session = createSdkSession(jwt);
  return session.getMatchDetails(String(matchId), Number(seasonId));
}
