import test from 'node:test';
import assert from 'node:assert/strict';
import { isAnnouncementPost, ANNOUNCEMENT_NOTICE, selectCommunityAnnouncementsGroup, buildAnnouncementMentionMessage } from '../src/announcementRouting.js';

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


test('only the official announcement child of the Geral community is selected', () => {
  const geral = { id: 'geral@g.us', linkedParent: 'sega-community@g.us' };
  const channels = {
    one: { id: 'official@g.us', isCommunityAnnounce: true, linkedParent: 'sega-community@g.us' },
    two: { id: 'other-community@g.us', isCommunityAnnounce: true, linkedParent: 'other@g.us' },
    three: { id: 'admins@g.us', announce: true, linkedParent: 'sega-community@g.us' }
  };
  assert.equal(selectCommunityAnnouncementsGroup(channels, geral), 'official@g.us');
  assert.equal(selectCommunityAnnouncementsGroup(channels, { id: 'geral@g.us' }), null);
  assert.equal(selectCommunityAnnouncementsGroup({ two: channels.two, three: channels.three }, geral), null);
  assert.equal(selectCommunityAnnouncementsGroup({ ...channels, four: { ...channels.one, id: 'duplicate@g.us' } }, geral), null);
});


test('official notice uses WhatsApp native @all, not a fixed list of member IDs', () => {
  const metadata = {
    id: 'geral@g.us',
    participants: [{ id: '5511999999999@s.whatsapp.net' }, { id: '123456789@lid' }]
  };
  const notice = buildAnnouncementMentionMessage(metadata, 'geral@g.us');
  assert.equal(notice.mentionAll, true);
  assert.match(notice.text, /@all/);
  assert.ok(notice.text.includes(ANNOUNCEMENT_NOTICE));
  assert.ok(!notice.text.includes('5511999999999'));
  assert.ok(!('mentions' in notice));
});

test('future membership changes require no changes to the native @all payload', () => {
  const first = { id: 'geral@g.us', participants: [{ id: '1@lid' }] };
  const updated = { id: 'geral@g.us', participants: [{ id: '1@lid' }, { id: '2@lid' }] };
  assert.deepEqual(buildAnnouncementMentionMessage(first, 'geral@g.us'), buildAnnouncementMentionMessage(updated, 'geral@g.us'));
});

test('fail closed if destination group identity or membership cannot be verified', () => {
  assert.equal(buildAnnouncementMentionMessage({ id: 'other@g.us', participants: [{ id: '1@lid' }] }, 'geral@g.us'), null);
  assert.equal(buildAnnouncementMentionMessage({ id: 'geral@g.us', participants: [] }, 'geral@g.us'), null);
  assert.equal(buildAnnouncementMentionMessage({ id: 'geral@g.us' }, 'geral@g.us'), null);
  assert.equal(buildAnnouncementMentionMessage({ id: 'geral@g.us', participants: [{ id: '1@lid' }] }, 'notgroup'), null);
});
