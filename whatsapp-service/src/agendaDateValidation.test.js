import test from 'node:test';
import assert from 'node:assert/strict';
import { validateAgendaDay, validateAgendaSchedule, agendaValidationMessage } from './agendaDateValidation.js';

// October 15th 2026, 18:47 Brasilia (21:47 UTC), as in the screenshot.
const NOW = Date.parse('2026-10-15T21:47:00.000Z');

test('old time in the same day is rejected with an accurate explanation', () => {
  const result = validateAgendaSchedule('15/10/2026', '00:01', NOW);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'hour_past');
  const message = agendaValidationMessage(result);
  assert.match(message, /Esse horário já passou/);
  assert.match(message, /15\/10\/2026 às 00:01/);
  assert.match(message, /18:47/);
  assert.doesNotMatch(message, /Use !editarevento ID/);
});

test('a future hour on the same day or 00:01 tomorrow can be scheduled', () => {
  const today = validateAgendaSchedule('15/10/2026', '21:00', NOW);
  assert.equal(today.ok, true);
  assert.equal(today.date.toISOString(), '2026-10-16T00:00:00.000Z');
  const tomorrow = validateAgendaSchedule('16/10/2026', '00:01', NOW);
  assert.equal(tomorrow.ok, true);
  assert.equal(tomorrow.date.toISOString(), '2026-10-16T03:01:00.000Z');
});

test('date wizard checks calendar before asking for an hour', () => {
  assert.equal(validateAgendaDay('15/10/2026', NOW).ok, true);
  assert.equal(validateAgendaDay('14/10/2026', NOW).reason, 'date_past');
  assert.equal(validateAgendaDay('31/04/2027', NOW).reason, 'date_invalid');
  assert.equal(validateAgendaDay('29/02/2027', NOW).reason, 'date_invalid');
  assert.equal(validateAgendaDay('29/02/2028', NOW).ok, true);
  assert.equal(validateAgendaDay('15/10/26', NOW).reason, 'date_format');
});

test('invalid hours and exact current minute cannot silently pass', () => {
  assert.equal(validateAgendaSchedule('15/10/2026','24:00',NOW).reason,'hour_invalid');
  assert.equal(validateAgendaSchedule('15/10/2026','23:60',NOW).reason,'hour_invalid');
  assert.equal(validateAgendaSchedule('15/10/2026','às 21h',NOW).reason,'hour_format');
  assert.equal(validateAgendaSchedule('15/10/2026','18:47',NOW).reason,'hour_past');
  assert.equal(validateAgendaSchedule('14/10/2026','23:00',NOW).reason,'date_past');
});
