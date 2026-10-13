import test from 'node:test';
import assert from 'node:assert/strict';
import { ownerIdentityMatchesPhone } from '../src/ownerIdentity.js';

const expected = '5511998765432';

test('accepts the configured WhatsApp owner phone JID, including companion device', () => {
  assert.equal(ownerIdentityMatchesPhone(['5511998765432:4@s.whatsapp.net'], expected), true);
  assert.equal(ownerIdentityMatchesPhone(['5511998765432@s.whatsapp.net'], expected), true);
});

test('accepts the legacy Brazilian owner number without mobile ninth digit', () => {
  assert.equal(ownerIdentityMatchesPhone(['551198765432:2@s.whatsapp.net'], expected), true);
});

test('rejects different phone numbers even on a correctly connected socket', () => {
  assert.equal(ownerIdentityMatchesPhone(['5511999999999@s.whatsapp.net'], expected), false);
  assert.equal(ownerIdentityMatchesPhone(['551198765433@s.whatsapp.net'], expected), false);
});

test('never treats an opaque WhatsApp LID as a phone number', () => {
  assert.equal(ownerIdentityMatchesPhone(['5511998765432@lid'], expected), false);
  assert.equal(ownerIdentityMatchesPhone(['someuser@s.whatsapp.net'], expected), false);
});

test('requires trustworthy JID and number formats', () => {
  assert.equal(ownerIdentityMatchesPhone(['5511998765432'], expected), false);
  assert.equal(ownerIdentityMatchesPhone([], expected), false);
  assert.equal(ownerIdentityMatchesPhone(['5511998765432@s.whatsapp.net'], ''), false);
});
