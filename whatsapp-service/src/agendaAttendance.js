// Persistent, identity-aware attendance bookkeeping for NOX clan events.
export function attendeeIds(ids) {
  return [...new Set((Array.isArray(ids) ? ids : [])
    .map(id => String(id || '').trim())
    .filter(id => /^\d+(?::\d+)?@(s\.whatsapp\.net|lid)$/.test(id)))].slice(0, 16);
}

export function attendanceFor(state, eventId) {
  const entries = state && typeof state === 'object' && !Array.isArray(state) ? state[eventId] : null;
  return Array.isArray(entries) ? entries.filter(entry => entry && Array.isArray(entry.ids)) : [];
}

export function isAttending(state, eventId, ids) {
  const aliases = new Set(attendeeIds(ids));
  return attendanceFor(state, eventId).some(entry => entry.ids.some(id => aliases.has(id)));
}

export function attendanceCount(state, eventId) {
  return attendanceFor(state, eventId).length;
}

export function changeAttendance(state, eventId, ids, displayName, attending, now = new Date()) {
  if (!/^[a-f0-9]{8}$/i.test(eventId)) throw new Error('ID do evento inválido');
  const identity = attendeeIds(ids);
  if (!identity.length) throw new Error('Participante sem identidade verificável');
  const data = state && typeof state === 'object' && !Array.isArray(state) ? { ...state } : {};
  const rows = attendanceFor(data, eventId);
  const known = rows.filter(entry => entry.ids.some(id => identity.includes(id)));
  const before = known.length > 0;
  const others = rows.filter(entry => !entry.ids.some(id => identity.includes(id)));
  if (attending) {
    const name = String(displayName || '').replace(/[\r\n\t\u0000-\u001f]+/g, ' ').trim().slice(0, 70);
    const merged = attendeeIds([...identity, ...known.flatMap(entry => entry.ids)]);
    others.push({
      ids: merged,
      name: name || known.find(entry => entry.name)?.name || 'Participante',
      confirmedAt: known[0]?.confirmedAt || now.toISOString(),
    });
    data[eventId] = others;
  } else if (others.length) {
    data[eventId] = others;
  } else {
    delete data[eventId];
  }
  return { data, changed: before !== Boolean(attending), attending: Boolean(attending) };
}

export function removeEventAttendance(state, eventId) {
  const data = state && typeof state === 'object' && !Array.isArray(state) ? { ...state } : {};
  delete data[eventId];
  return data;
}
