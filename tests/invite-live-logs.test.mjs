import test from 'node:test';
import assert from 'node:assert/strict';
import {createLiveLogFeed} from '../browser-extension/invitation/shared/invite-live-logs.js';

test('live logs retain only latest 200 and display chronological activity', async () => {
  let visible;
  const feed = createLiveLogFeed({read: async () => Array.from({length: 220}, (_, id) => ({id})), render: rows => visible = rows, report: assert.fail});
  await feed.refresh('account-A');
  assert.equal(visible.length, 200); assert.equal(visible[0].id, 199); assert.equal(visible.at(-1).id, 0);
});
test('scope change clears immediately and discards stale pending result', async () => {
  const pending = []; let visible;
  const feed = createLiveLogFeed({read: () => new Promise(resolve => pending.push(resolve)), render: rows => visible = rows, report: assert.fail});
  const first = feed.refresh('account-A');
  const second = feed.refresh('account-B');
  assert.deepEqual(visible, []);
  pending[1]([{id: 'B'}]); await second;
  pending[0]([{id: 'A'}]); await first;
  assert.deepEqual(visible, [{id:'B'}]);
});
test('license loss clears feed and ignores late errors; same-scope polls never overlap', async () => {
  let rejectRead, calls = 0, visible;
  const feed = createLiveLogFeed({read: () => { calls++; return new Promise((_, reject) => rejectRead = reject); }, render: rows => visible = rows, report: assert.fail});
  const first = feed.refresh('A'); await feed.refresh('A'); assert.equal(calls, 1);
  await feed.refresh(null); assert.deepEqual(visible, []);
  rejectRead(Error('late')); await first; assert.deepEqual(visible, []);
});
test('failed reads report and permit retry', async () => {
  let calls = 0, error, visible;
  const feed = createLiveLogFeed({read: async () => { if (!calls++) throw Error('offline'); return [{id:'ok'}]; }, render: rows => visible = rows, report: value => error = value});
  await feed.refresh('A'); assert.equal(error.message, 'offline');
  await feed.refresh('A'); assert.deepEqual(visible,[{id:'ok'}]);
});
