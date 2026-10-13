import test from 'node:test';
import assert from 'node:assert/strict';
import { ownerIdentityMatchesPhone } from '../src/ownerIdentity.js';

const expected = '5547984746350';

test('accepts the configured WhatsApp owner phone JID, including companion device', () => {
  assert.equal(ownerIdentityMatchesPhone(['5547984746350:4@s.whatsapp.net'], expected), true);
  assert.equal(ownerIdentityMatchesPhone(['5547984746350@s.whatsapp.net'], expected), true);
});

test('accepts the legacy Brazilian owner number without mobile ninth digit', () => {
  assert.equal(ownerIdentityMatchesPhone(['554784746350:2@s.whatsapp.net'], expected), true);
});

test('rejects different phone numbers even on a correctly connected socket', () => {
  assert.equal(ownerIdentityMatchesPhone(['5547999999999@s.whatsapp.net'], expected), false);
  assert.equal(ownerIdentityMatchesPhone(['554784746351@s.whatsapp.net'], expected), false);
});

test('never treats an opaque WhatsApp LID as a phone number', () => {
  assert.equal(ownerIdentityMatchesPhone(['5547984746350@lid'], expected), false);
  assert.equal(ownerIdentityMatchesPhone(['someuser@s.whatsapp.net'], expected), false);
});

test('requires trustworthy JID and number formats', () => {
  assert.equal(ownerIdentityMatchesPhone(['5547984746350'], expected), false);
  assert.equal(ownerIdentityMatchesPhone([], expected), false);
  assert.equal(ownerIdentityMatchesPhone(['5547984746350@s.whatsapp.net'], ''), false);
});
