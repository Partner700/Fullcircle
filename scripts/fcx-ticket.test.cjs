const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const sql = read('supabase/migrations/20261015120000_fcx_denarii_tickets_and_external_attendees.sql');
const market = read('src/screens/cadet/CadetStore.tsx');
const manager = read('src/components/FcxExperience.tsx');
const dashboard = read('src/screens/cadet/CadetDashboard.tsx');
const roster = read('supabase/migrations/20260825120000_fcx_guest_photos.sql');

const ticket = sql.match(/CREATE OR REPLACE FUNCTION public\.purchase_fcx_ticket\(p_event_id uuid\)([\s\S]*?)\n\$\$;/)?.[1];
assert.ok(ticket, 'FCX ticket RPC must exist');
assert.match(sql, /'player_number_purchase', 'fcx_ticket'/);
assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS fcx_ticket_one_debit_per_member_event/);
assert.match(ticket, /v_cost integer := 600000/);
assert.match(ticket, /v_buyer uuid := auth\.uid\(\)/);
assert.match(ticket, /public\.has_current_subscription_access\(v_buyer\)/);
assert.match(ticket, /WHERE id = p_event_id AND is_active = true\s+FOR UPDATE/);
assert.match(ticket, /'already_registered', true, 'cost', 0/);
assert.match(ticket, /count\(\*\) FROM public\.fcx_registrations WHERE event_id = p_event_id/);
assert.match(ticket, /This FCX ticket was already purchased/);
assert.match(ticket, /INSERT INTO public\.denarii_ledger_entries[\s\S]*?-v_cost, 'fcx_ticket'/);
assert.match(ticket, /INSERT INTO public\.fcx_registrations \(event_id, user_id, payment_source, added_by\)[\s\S]*?'app'/);
assert.ok(ticket.indexOf("'already_registered', true") < ticket.indexOf('INSERT INTO public.denarii_ledger_entries'));
assert.ok(ticket.indexOf('All FCX spaces are already filled') < ticket.indexOf('INSERT INTO public.denarii_ledger_entries'));
assert.ok(ticket.indexOf('INSERT INTO public.denarii_ledger_entries') < ticket.indexOf('INSERT INTO public.fcx_registrations'));
assert.match(sql, /REVOKE ALL ON FUNCTION public\.purchase_fcx_ticket\(uuid\) FROM PUBLIC, anon/);

const external = sql.match(/CREATE OR REPLACE FUNCTION public\.add_fcx_external_attendee\([\s\S]*?\n\$\$;/)?.[0];
assert.ok(external);
assert.match(external, /public\.is_instructor\(v_actor\)/);
assert.match(external, /WHERE id = p_event_id AND is_active = true\s+FOR UPDATE/);
assert.match(external, /This attendee is already on the paid FCX list/);
assert.match(external, /'external', v_actor/);
assert.match(sql, /CREATE OR REPLACE FUNCTION public\.set_fcx_external_attendee_photo/);
assert.match(sql, /registration\.user_id IS NULL/);
assert.match(manager, /addFcxExternalAttendee\(experience\.id, guestName\)/);
assert.match(manager, /Promise\.allSettled\(\[\s*fetchActiveFcxExperience\(\),\s*fetchAllProfiles\(\)/);
assert.match(manager, /if \(guestPhoto\)[\s\S]*?setFcxExternalAttendeePhoto\(registrationId, guestAvatarUrl\)/);

assert.match(market, /FCX_TICKET_DENARII_COST = 600_000/);
assert.match(market, /purchaseFcxTicket\(fcxExperience\.id\)/);
assert.match(market, /void fetchActiveFcxExperience\(\)[\s\S]*?\.then\(\(event\) => \{ if \(!cancelled\) setFcxExperience\(event\)/);
assert.match(roster, /'avatar_url', COALESCE\(profile\.avatar_url, entry\.guest_avatar_url\)/);
assert.match(dashboard, /slide\.announcement\.announcement_type === 'birthday'\s*\? panelImages\.announcement/);

console.log('FCX ticket, external attendee, avatar, and birthday artwork checks passed.');
