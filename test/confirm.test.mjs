import test from 'node:test';
import assert from 'node:assert/strict';
import { Confirmations } from '../src/confirm.ts';

const pending = () => ({userId: 101, chatId: 101, summary: 'delete test instance', action: async () => 'ok'});

test('confirmation token is unique, single use, and cannot be replayed', async () => {
  const confirms = new Confirmations();
  const token = confirms.create(pending());
  assert.match(token, /^[a-f0-9]{36}$/);
  const first = confirms.take(token, 101, 101);
  assert.ok(first);
  assert.equal(await first.action(), 'ok');
  assert.equal(confirms.take(token, 101, 101), undefined);
});

test('other users and chats cannot steal or cancel confirmation', () => {
  const confirms = new Confirmations();
  const token = confirms.create(pending());
  assert.equal(confirms.take(token, 999, 101), undefined);
  assert.equal(confirms.take(token, 101, 999), undefined);
  assert.equal(confirms.cancel(token, 999, 101), false);
  assert.ok(confirms.take(token, 101, 101));
});

test('expired or cancelled confirmations cannot execute', () => {
  const expired = new Confirmations(0);
  assert.equal(expired.take(expired.create(pending()), 101, 101), undefined);
  const confirms = new Confirmations();
  const token = confirms.create(pending());
  assert.equal(confirms.cancel(token, 101, 101), true);
  assert.equal(confirms.take(token, 101, 101), undefined);
});

test('creating another confirmation invalidates an earlier one for same admin/chat', () => {
  const confirms = new Confirmations();
  const old = confirms.create(pending());
  const current = confirms.create(pending());
  assert.equal(confirms.take(old, 101, 101), undefined);
  assert.ok(confirms.take(current, 101, 101));
});
