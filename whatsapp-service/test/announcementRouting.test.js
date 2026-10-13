import test from 'node:test';
import assert from 'node:assert/strict';
import { isAnnouncementPost, ANNOUNCEMENT_NOTICE } from '../src/announcementRouting.js';

const group = 'announcements@g.us';
const message = { key: { id: 'abc', fromMe: false, remoteJid: group }, message: { conversation: 'Important news' } };

test('new announcements trigger short notices without copying original content', () => {
  assert.equal(isAnnouncementPost(message, 'notify', group), true);
  assert.ok(!ANNOUNCEMENT_NOTICE.includes('Important news'));
});

test('ignore history, reactions, unexpected groups and missing message IDs', () => {
  assert.equal(isAnnouncementPost(message, 'append', group), false);
  assert.equal(isAnnouncementPost({ ...message, message: { reactionMessage: {} } }, 'notify', group), false);
  assert.equal(isAnnouncementPost(message, 'notify', 'other@g.us'), false);
  assert.equal(isAnnouncementPost({ ...message, key: { ...message.key, id: undefined } }, 'notify', group), false);
});

test('owner announcements sent through synced device may arrive as append', () => {
  const ownerPost = { ...message, key: { ...message.key, fromMe: true } };
  assert.equal(isAnnouncementPost(ownerPost, 'append', group), true);
  assert.equal(isAnnouncementPost(ownerPost, 'notify', group), true);
});

test('image posts and ephemeral text count as announcements', () => {
  assert.equal(isAnnouncementPost({ ...message, message: { imageMessage: {} } }, 'notify', group), true);
  assert.equal(isAnnouncementPost({ ...message, message: { ephemeralMessage: { message: { conversation: 'x' } } } }, 'notify', group), true);
});
