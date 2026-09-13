const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');

function load(file, extras = {}, dependencies = {}) {
  const exports = {};
  const context = vm.createContext({
    exports, require: name => { if (name in dependencies) return dependencies[name]; throw new Error('Unexpected import: ' + name); },
    console: { error() {}, log() {} }, URL, URLSearchParams, Request, Response, Date,
    File, Blob, setTimeout, clearTimeout, ...extras,
  });
  const js = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  vm.runInContext(js, context);
  return { exports, context };
}

async function testUploads() {
  let closed = 0;
  let dimensions = [400, 300];
  const canvas = { width: 0, height: 0, getContext: () => ({ drawImage() {} }),
    toBlob: callback => callback(new Blob(['compressed'], { type: 'image/png' })) };
  const { exports: uploads, context } = load('src/lib/uploads.ts', {
    createImageBitmap: async () => ({ width: dimensions[0], height: dimensions[1], close() { closed++; } }),
    document: { createElement: () => canvas },
  });
  const photo = new File(['photo'], 'CAMERA.JPG', { type: '' });
  assert.equal(uploads.imageFileType(photo), 'image/jpeg');
  const small = await uploads.prepareImageUpload(photo);
  assert.equal(small.file.type, 'image/jpeg'); assert.equal(small.extension, 'jpg'); assert.equal(closed, 1);
  dimensions = [6000, 4000];
  const reduced = await uploads.prepareImageUpload(photo);
  assert.equal(reduced.extension, 'png', 'Canvas fallback must match real output MIME');
  assert.equal(reduced.file.type, 'image/png');
  assert.equal(canvas.width, 2200); assert.equal(canvas.height, 1467); assert.equal(closed, 2);
  await assert.rejects(uploads.prepareImageUpload(new File(['bad'], 'photo.svg', { type: 'image/svg+xml' })), /Choose a JPEG/);
  await assert.rejects(uploads.prepareImageUpload(new File([], 'empty.jpg')), /between 1 byte/);
  await assert.rejects(uploads.prepareImageUpload(photo, { maxBytes: 2 }), /between 1 byte/);
  // Older phone decoders must still resize instead of uploading the original.
  let revoked = 0;
  context.createImageBitmap = undefined;
  context.window = { setTimeout };
  context.URL = { createObjectURL: () => 'blob:fixture', revokeObjectURL: () => revoked++ };
  context.Image = class { naturalWidth = 5000; naturalHeight = 3000; set src(value) { queueMicrotask(() => this.onload()); } };
  assert.equal((await uploads.prepareImageUpload(photo)).extension, 'png'); assert.equal(revoked, 1);
  context.Image = class { set src(value) { queueMicrotask(() => this.onerror()); } };
  await assert.rejects(uploads.prepareImageUpload(new File(['broken'], 'phone.heic')), /HEIC photo/);
  assert.equal(revoked, 2);
  const attempts = [];
  let refreshed = 0;
  let failure = null;
  const storage = {
    upload: async (key, file, options) => { attempts.push({ key, options }); return { error: attempts.length === 1 ? { message: 'JWT expired' } : failure }; },
    getPublicUrl: key => ({ data: { publicUrl: 'https://test.invalid/' + key } }),
  };
  const { exports: appUploads } = load('src/lib/storageUploads.ts', {}, {
    './supabase': { supabase: { storage: { from: () => storage }, auth: { refreshSession: async () => { refreshed++; return { error: null }; } } } },
  });
  await appUploads.uploadAppFile('user/challenge-evidence/photo.jpg', small.file);
  assert.equal(attempts.length, 2); assert.equal(refreshed, 1); assert.equal(attempts[1].options.contentType, 'image/jpeg');
  failure = { message: 'new row violates row-level security policy' };
  await assert.rejects(appUploads.uploadAppFile('user/photo.jpg', small.file), /permission was denied/);
  failure = { message: 'Failed to fetch' };
  await assert.rejects(appUploads.uploadAppFile('user/photo.jpg', small.file), /lost its connection/);
}

async function testPush() {
  let handler;
  let active = true;
  let callCurrent = true;
  let authorized = true;
  let subscriptionFailure = true;
  let notificationType = 'scripture_alarm';
  const receipts = new Set();
  const sent = [];
  let expiresAt = new Date(Date.now() + 90000).toISOString();
  const callId = '00000000-0000-0000-0000-000000000099';
  const response = data => Response.json(data);
  load('supabase/functions/send-push-notification/index.ts', {
    Deno: { env: { get: () => 'test-only-key' }, serve: fn => { handler = fn; } },
    fetch: async (url, options = {}) => {
      if (url.includes('verify_push_webhook_secret')) return response(authorized);
      if (url.includes('alarm_push_is_current')) return response(active);
      if (url.includes('audio_call_push_is_current')) return response(callCurrent);
      if (url.includes('user_notifications?')) return response([{ id: 'notification', recipient_id: 'user', title: 'Prayer',
        notification_type: notificationType, action_key: notificationType === 'audio_call' ? 'call' : 'narrative',
        metadata: notificationType === 'audio_call' ? { expires_at: expiresAt, call_id: callId } : { expires_at: expiresAt, alarm_id: 'alarm' } }]);
      if (url.includes('alarm_push_receipts?')) return response([...receipts].map(subscription_id => ({ subscription_id })));
      if (url.endsWith('alarm_push_receipts')) { receipts.add(JSON.parse(options.body).subscription_id); return response({}); }
      if (url.includes('push_subscriptions?')) return response([
        { id: 'phone', endpoint: 'phone', p256dh: 'test', auth: 'test' }, { id: 'tablet', endpoint: 'tablet', p256dh: 'test', auth: 'test' },
      ]);
      throw new Error('Unexpected fetch: ' + url);
    },
  }, {
    'jsr:@supabase/functions-js/edge-runtime.d.ts': {},
    'npm:web-push@3.6.7': { setVapidDetails() {}, sendNotification: async (subscription, payload, options) => {
      sent.push({ endpoint: subscription.endpoint, payload: JSON.parse(payload), options });
      if (subscription.endpoint === 'tablet' && subscriptionFailure) throw { statusCode: 503 };
    } },
  });
  const request = () => new Request('https://test.invalid', { method: 'POST', body: JSON.stringify({ notification_id: 'notification' }), headers: { 'x-full-circle-push-secret': 'test' } });
  assert.equal((await handler(request())).status, 503);
  assert.equal(receipts.has('phone'), true); assert.equal(receipts.has('tablet'), false);
  assert.ok(sent[0].options.TTL > 0 && sent[0].options.TTL <= 90); assert.equal(sent[0].options.urgency, 'high');
  subscriptionFailure = false;
  assert.equal((await handler(request())).status, 200);
  assert.deepEqual(sent.map(item => item.endpoint), ['phone', 'tablet', 'tablet'], 'Retry only devices that failed');
  assert.equal(receipts.size, 2);
  active = false;
  assert.equal((await handler(request())).status, 200); assert.equal(sent.length, 3, 'Do not send cleared/completed alarms');
  active = true; receipts.clear(); expiresAt = new Date(Date.now() - 1000).toISOString();
  await handler(request()); assert.equal(sent.length, 3, 'Do not send expired alarms');
  notificationType = 'audio_call';
  expiresAt = new Date(Date.now() + 120000).toISOString();
  assert.equal((await handler(request())).status, 200);
  assert.equal(sent.length, 5);
  const callPush = sent[3];
  assert.equal(callPush.payload.tag, `full-circle-audio-call-${callId}`);
  assert.equal(callPush.payload.image, '/notification-symbols/call.svg');
  assert.equal(callPush.payload.requireInteraction, true);
  assert.equal(callPush.payload.renotify, true);
  assert.equal(callPush.payload.actions[0].action, 'join');
  assert.match(callPush.payload.url, /fc-call=00000000-0000-0000-0000-000000000099/);
  assert.equal(callPush.options.urgency, 'high');
  await handler(request());
  assert.equal(sent.length, 7, 'A repeated call push replaces and re-rings the same notification tag');
  callCurrent = false;
  await handler(request());
  assert.equal(sent.length, 7, 'Do not ring after a call was answered or ended');
  authorized = false; assert.equal((await handler(request())).status, 401);
}

(async () => { await testUploads(); await testPush(); console.log('Photo preparation, upload recovery, alarm push, and call push tests passed.'); })()
  .catch(error => { console.error(error); process.exitCode = 1; });
