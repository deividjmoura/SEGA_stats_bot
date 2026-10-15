export const RSVP_CLOSE_BEFORE_MS = 30 * 60 * 1000;
export const REMINDER_BEFORE_MS = 60 * 60 * 1000;

export function eventTimestamp(event) {
  const date = Date.parse(event?.date || '');
  return Number.isFinite(date) ? date : NaN;
}
export function isRsvpOpen(event, now = Date.now()) {
  const start = eventTimestamp(event);
  return Number.isFinite(start) && now < start - RSVP_CLOSE_BEFORE_MS;
}
export function dueAgendaActions(events, history, now = Date.now()) {
  const pending = [];
  for (const event of Array.isArray(events) ? events : []) {
    const start = eventTimestamp(event);
    if (!/^[a-f0-9]{8}$/i.test(event?.id || '') || !Number.isFinite(start) ||
        now >= start || now < start - REMINDER_BEFORE_MS) continue;
    const done = history?.[event.id] || {};
    if (now < start - RSVP_CLOSE_BEFORE_MS) {
      if (!done.reminderAt) pending.push({type:'reminder',event});
    } else if (!done.reportAt) {
      pending.push({type:'report',event});
    }
  }
  return pending;
}
export function participantAliases(participant) {
  const values = [participant?.id, participant?.jid, participant?.lid,
    participant?.phoneNumber, participant?.phoneNumberJid]
    .map(value => typeof value === 'string' ? value.trim() : '')
    .filter(Boolean);
  return [...new Set(values.filter(value =>
    /^\d+(?::\d+)?@(s\.whatsapp\.net|lid)$/.test(value)))];
}
export function partitionRoster(attendees, participants, resolveAliases = ids => ids) {
  const confirmed = Array.isArray(attendees) ? attendees : [];
  const present = [];
  const absent = [];
  for (const member of Array.isArray(participants) ? participants : []) {
    const aliases = resolveAliases(participantAliases(member));
    if (!aliases.length) continue;
    const check = confirmed.find(row =>
      Array.isArray(row.ids) && row.ids.some(id => aliases.includes(id)));
    (check ? present : absent).push({participant:member,aliases,attendance:check||null});
  }
  return { present, absent };
}
