// Date/time rules shared by the administrator wizard and the compact commands.
// Clan events are scheduled in Brasilia (America/Sao_Paulo, UTC-03 in 2026).
const BRASILIA_OFFSET_MS = 3 * 60 * 60 * 1000;
const formatDate = ms => new Date(ms).toLocaleString('pt-BR', {
  timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit',
  year: 'numeric', hour: '2-digit', minute: '2-digit'
});

export function validateAgendaDay(value, nowMs = Date.now()) {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(value || '').trim());
  if (!match) return {ok:false, reason:'date_format'};
  const [, dd, mm, yyyy] = match;
  const midnight = new Date(yyyy + '-' + mm + '-' + dd + 'T00:00:00-03:00');
  if (!Number.isFinite(midnight.getTime())) return {ok:false, reason:'date_invalid'};
  const local = new Date(midnight.getTime() - BRASILIA_OFFSET_MS);
  if (local.getUTCFullYear() !== Number(yyyy) ||
      local.getUTCMonth() + 1 !== Number(mm) ||
      local.getUTCDate() !== Number(dd)) return {ok:false, reason:'date_invalid'};
  if (midnight.getTime() + 24 * 60 * 60 * 1000 <= nowMs) {
    return {ok:false, reason:'date_past'};
  }
  return {ok:true, value:dd+'/'+mm+'/'+yyyy};
}

export function validateAgendaSchedule(day, hour, nowMs = Date.now()) {
  const dateResult = validateAgendaDay(day, nowMs);
  if (!dateResult.ok) return dateResult;
  const match = /^(\d{2}):(\d{2})$/.exec(String(hour || '').trim());
  if (!match) return {ok:false, reason:'hour_format'};
  const [, hh, min] = match;
  if (Number(hh) > 23 || Number(min) > 59) return {ok:false, reason:'hour_invalid'};
  const [dd, mm, yyyy] = dateResult.value.split('/');
  const date = new Date(yyyy + '-' + mm + '-' + dd + 'T' + hh + ':' + min + ':00-03:00');
  if (!Number.isFinite(date.getTime())) return {ok:false, reason:'hour_invalid'};
  const local = new Date(date.getTime() - BRASILIA_OFFSET_MS);
  if (local.getUTCFullYear() !== Number(yyyy) ||
      local.getUTCMonth() + 1 !== Number(mm) ||
      local.getUTCDate() !== Number(dd) ||
      local.getUTCHours() !== Number(hh) ||
      local.getUTCMinutes() !== Number(min)) return {ok:false, reason:'hour_invalid'};
  if (date.getTime() <= nowMs) {
    return {ok:false, reason:'hour_past', when:dateResult.value + ' às ' + hh + ':' + min,
      now:formatDate(nowMs)};
  }
  return {ok:true, date, value:dateResult.value + ' às ' + hh + ':' + min};
}

export function agendaValidationMessage(result) {
  if (!result || result.ok) return '';
  switch (result.reason) {
    case 'date_format': return '⚠️ Data no formato errado. Use *DD/MM/AAAA* (ex.: 16/10/2026).';
    case 'date_invalid': return '⚠️ Essa data não existe no calendário. Informe uma data válida em *DD/MM/AAAA*.';
    case 'date_past': return '⚠️ Essa data já passou. Escolha hoje ou uma data futura (DD/MM/AAAA).';
    case 'hour_format': return '⚠️ Horário no formato errado. Use *HH:MM* (ex.: 21:00).';
    case 'hour_invalid': return '⚠️ Esse horário não existe. Informe uma hora de *00:00 até 23:59*.';
    case 'hour_past': return '⏰ *Esse horário já passou!* Você escolheu *' + result.when +
      '* (Brasília), mas agora são *' + result.now + '*. Escolha um horário futuro.';
    default: return '⚠️ Data e hora inválidas. Tente novamente.';
  }
}
