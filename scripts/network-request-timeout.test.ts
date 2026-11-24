import assert from 'node:assert/strict';
import { isSlowArenaRead, networkAttemptTimeout } from '../src/lib/networkRequestTimeout.ts';

const objectUrl = 'https://example.supabase.co/storage/v1/object/avatars/user/photo.webp';
assert.equal(networkAttemptTimeout(objectUrl, 'POST'), 90_000);
assert.equal(networkAttemptTimeout(new URL(objectUrl), 'PUT'), 90_000);
assert.equal(networkAttemptTimeout(new Request(objectUrl), 'POST'), 90_000);
assert.equal(networkAttemptTimeout(objectUrl, 'GET'), 10_000);
assert.equal(networkAttemptTimeout('https://example.supabase.co/auth/v1/signup', 'POST'), 30_000);
assert.equal(networkAttemptTimeout('https://example.supabase.co/auth/v1/token?grant_type=password', 'POST'), 30_000);
assert.equal(networkAttemptTimeout('https://example.supabase.co/auth/v1/token?grant_type=refresh_token', 'POST'), 30_000);
assert.equal(networkAttemptTimeout('https://example.supabase.co/rest/v1/profiles', 'POST'), 10_000);
assert.equal(networkAttemptTimeout('https://example.supabase.co/storage/v1/object/sign/avatars/photo.webp', 'POST'), 10_000);
console.log('Photo uploads have a longer deadline without slowing other requests.');

assert.equal(networkAttemptTimeout('https://example.supabase.co/rest/v1/arena_rooms?select=id', 'GET'), 22_000);
assert.equal(networkAttemptTimeout('https://example.supabase.co/rest/v1/arena_journey_games?room_id=eq.x', 'GET'), 22_000);
assert.equal(networkAttemptTimeout('https://example.supabase.co/rest/v1/profiles', 'GET'), 10_000);
assert.equal(isSlowArenaRead('https://example.supabase.co/rest/v1/arena_rooms?select=id', 'GET'), true);
assert.equal(isSlowArenaRead('https://example.supabase.co/rest/v1/arena_rooms?select=id', 'POST'), false);
