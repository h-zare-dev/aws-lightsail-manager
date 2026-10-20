import test from 'node:test';
import assert from 'node:assert/strict';
import { checkName, checkZone, checkPort, checkCIDR, makePortInfo, checkScriptName } from '../src/policy.mjs';
test('rejects invalid resource names', () => {
  for (const n of ['a', '../etc/passwd', 'with spaces', '-bad', 'a/', '', 'a'.repeat(256)]) assert.throws(() => checkName(n));
  assert.equal(checkName('DE01-New'), 'DE01-New');
});
test('zone must match selected region', () => {
  assert.equal(checkZone('eu-central-1a', 'eu-central-1'), 'eu-central-1a');
  assert.throws(() => checkZone('us-east-1a', 'eu-central-1'));
});
test('validates port ranges and protocol', () => {
  assert.deepEqual(makePortInfo('tcp', '1000', '60000', '0.0.0.0/0'), {protocol: 'tcp', fromPort: 1000, toPort: 60000, cidrs: ['0.0.0.0/0']});
  assert.throws(() => makePortInfo('tcp', '9000', '5000', '0.0.0.0/0'));
  assert.throws(() => makePortInfo('x', 5, 5, '0.0.0.0/0'));
  assert.throws(() => checkPort('65536'));
  assert.throws(() => checkPort('3.1'));
});
test('validates IPv4 and IPv6 CIDR', () => {
  assert.deepEqual(checkCIDR('2001:db8::/64'), { value: '2001:db8::/64', version: 6 });
  assert.equal(makePortInfo('udp', 53, 53, '::/0').ipv6Cidrs[0], '::/0');
  for (const bad of ['1.1.1.1/40', '2001:db8::/129', '1.1.1.999/32', 'abc', '0.0.0.0/-1']) assert.throws(() => checkCIDR(bad));
});
test('script names cannot escape approved folder', () => {
  assert.equal(checkScriptName('bootstrap-1.sh'), 'bootstrap-1.sh');
  assert.throws(() => checkScriptName('../../credentials'));
  assert.throws(() => checkScriptName('subdir/x.sh'));
});
