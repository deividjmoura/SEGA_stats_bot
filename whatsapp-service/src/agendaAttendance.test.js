import test from 'node:test';
import assert from 'node:assert/strict';
import { changeAttendance, attendanceCount, isAttending, removeEventAttendance } from './agendaAttendance.js';
import { dueAgendaActions, isRsvpOpen, partitionRoster } from './agendaTiming.js';

const event={id:'abcdef12',title:'Treino',date:'2026-10-20T23:00:00.000Z'};
const stamp=Date.parse(event.date);
const A='123456789@lid', B='5511999999999@s.whatsapp.net', C='5511888888888@s.whatsapp.net';

test('RSVP count deduplicates one player with multiple JID aliases',()=>{
  let state={};
  state=changeAttendance(state,event.id,[A,B],'Abaddon',true).data;
  state=changeAttendance(state,event.id,[B],'Abaddon',true).data;
  assert.equal(attendanceCount(state,event.id),1);
  assert.equal(isAttending(state,event.id,[A]),true);
  assert.equal(isAttending(state,event.id,[B]),true);
  state=changeAttendance(state,event.id,[C],'Another',true).data;
  assert.equal(attendanceCount(state,event.id),2);
  state=changeAttendance(state,event.id,[A],'Abaddon',false).data;
  assert.equal(attendanceCount(state,event.id),1);
  assert.equal(isAttending(state,event.id,[C]),true);
  assert.deepEqual(removeEventAttendance(state,event.id),{});
});

test('RSVP closes 30 minutes before start; reminder at one hour',()=>{
  assert.equal(isRsvpOpen(event,stamp-30*60*1000-1),true);
  assert.equal(isRsvpOpen(event,stamp-30*60*1000),false);
  assert.equal(dueAgendaActions([event],{},stamp-60*60*1000)[0].type,'reminder');
  assert.deepEqual(dueAgendaActions([event],{abcdef12:{reminderAt:'sent'}},stamp-45*60*1000),[]);
  assert.equal(dueAgendaActions([event],{},stamp-30*60*1000)[0].type,'report');
  assert.deepEqual(dueAgendaActions([event],{abcdef12:{reportAt:'sent'}},stamp-29*60*1000),[]);
  assert.deepEqual(dueAgendaActions([event],{},stamp),[]);
});

test('attendance report partitions the official roster',()=>{
  const members=[{id:A},{id:C}];
  const attendee=[{ids:[A,B],name:'Abaddon'}];
  const result=partitionRoster(attendee,members);
  assert.equal(result.present.length,1);
  assert.equal(result.absent.length,1);
  assert.equal(result.absent[0].aliases[0],C);
});
