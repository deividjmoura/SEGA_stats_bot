import test from 'node:test';
import assert from 'node:assert/strict';
import { isAnnouncementPost, ANNOUNCEMENT_NOTICE } from '../src/announcementRouting.js';

const group = 'announcements@g.us';
const message = { key: { id: 'abc', fromMe: false, remoteJid: group }, message: { conversation: 'Important news' } };

test('new announcements notify without copying content', () => {
  assert.equal(isAnnouncementPost(message, 'notify', group), true);
  assert.ok(!ANNOUNCEMENT_NOTICE.includes('Important news'));
});
test('never notify about history, bot messages, reactions, other groups or missing IDs', () => {
  assert.equal(isAnnouncementPost(message, 'append', group), false);
  assert.equal(isAnnouncementPost({ ...message, key: { ...message.key, fromMe: true } }, 'notify', group), false);
  assert.equal(isAnnouncementPost({ ...message, message: { reactionMessage: {} } }, 'notify', group), false);
  assert.equal(isAnnouncementPost(message, 'notify', 'other@g.us'), false);
  assert.equal(isAnnouncementPost({ ...message, key: { ...message.key, id: undefined } }, 'notify', group), false);
});
test('image announcements and ephemeral messages qualify', () => {
  assert.equal(isAnnouncementPost({ ...message, message: { imageMessage: {} } }, 'notify', group), true);
  assert.equal(isAnnouncementPost({ ...message, message: { ephemeralMessage: { message: { conversation: 'x' } } } }, 'notify', group), true);
});
