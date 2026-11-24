import assert from 'node:assert/strict';
import { clearVerifiedMemberCamp, readVerifiedMemberCamp, rememberVerifiedMemberCamp } from '../src/lib/campAccessRecovery.ts';

const storage = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => { storage.set(key, value); },
  removeItem: (key: string) => { storage.delete(key); },
} });
assert.equal(readVerifiedMemberCamp('a'), null, 'New users may not bypass the staff check');
rememberVerifiedMemberCamp('a', 'none');
assert.deepEqual(readVerifiedMemberCamp('a'), { role: 'none' });
assert.equal(readVerifiedMemberCamp('b'), null, 'Cache must be scoped to the signed-in account');
rememberVerifiedMemberCamp('a', 'admin');
assert.equal(readVerifiedMemberCamp('a'), null, 'Staff access is never cached');
rememberVerifiedMemberCamp('a', 'none');
rememberVerifiedMemberCamp('a', 'instructor');
assert.equal(readVerifiedMemberCamp('a'), null, 'Staff elevation revokes member cache');
rememberVerifiedMemberCamp('a', 'none');
clearVerifiedMemberCamp('a');
assert.equal(readVerifiedMemberCamp('a'), null);
console.log('Camp access cache only permits previously verified members.');
