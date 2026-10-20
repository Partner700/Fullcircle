import React from 'react';
import { createRoot } from 'react-dom/client';
import '../../src/index.css';
import { createJourneyRuntime, publicJourneyRuntime, rollJourneyDie, answerJourneyQuestion, advanceMachineJourney, type JourneyQuestion } from '../../supabase/functions/_shared/biblicalJourneyRuntime';
import { JOURNEY_MACHINE_ID } from '../../supabase/functions/_shared/biblicalJourney';

// This fixture never contacts the live backend. Its transport uses the actual game engine.
const questions: JourneyQuestion[] = Array.from({ length: 50 }, (_, i) => ({
  id: `q-${i}`, stage: Math.floor(i / 10) + 1, type: 'multiple_choice',
  question: 'What did Elisha ask to receive before Elijah was taken away?',
  options: ['A double portion of his spirit', 'A royal crown', 'A field of grain'],
  correctAnswer: 'A double portion of his spirit', acceptedAnswers: [],
  reference: '2 Kings 2:9', explanation: 'Elisha asked for a double portion of Elijah\'s spirit.',
}));
const lookup = async (id: string) => questions.find((question) => question.id === id) || null;
const params = new URLSearchParams(location.search);
const machine = params.has('machine');
const ids = machine ? ['alpha', JOURNEY_MACHINE_ID] : ['alpha', 'beta', 'gamma', 'delta'];
let runtime = await createJourneyRuntime('elisha', ids, questions, lookup, () => 0);
if (params.has('trap')) runtime.game.players[0].location = { route: 'main', space: 4 };
if (params.has('bad')) runtime.game.players[0].location = { route: 'main', space: 19 };
if (params.has('legacy')) {
  delete runtime.game.boardSpaces;
  runtime.game.players[0].location = { route: 'main', space: 51 };
}
if (params.has('witness')) runtime = rollJourneyDie(runtime, 'alpha', () => 0);
const nativeFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.includes('/functions/v1/biblical-journey')) {
    const body = JSON.parse(String(init?.body || '{}'));
    if (body.action === 'ROLL') runtime = rollJourneyDie(runtime, 'alpha', () => 0);
    if (body.action === 'ANSWER') runtime = await answerJourneyQuestion(runtime, 'alpha', body.answer, lookup, () => 0);
    if (body.action === 'BOT') runtime = await advanceMachineJourney(runtime, lookup, () => 0, 1);
    if (body.action === 'GET' && body.knownVersion === runtime.game.version) return Response.json({ unchanged: true, state: null });
    return Response.json({ state: publicJourneyRuntime(runtime), version: runtime.game.version });
  }
  if (url.includes('.supabase.co')) return Response.json([]);
  return nativeFetch(input, init);
};
const { supabase } = await import('../../src/lib/supabase');
supabase.auth.getSession = async () => ({ data: { session: { access_token: 'local-fixture-only' } }, error: null }) as never;
const { JourneyGamePlay } = await import('../../src/screens/cadet/JourneyGamePlay');
const names = ['PH', 'Sentinel Vedette', 'Victoire Ebo', 'Comfort'];
const players = ids.map((id, i) => ({ user_id: id, display_name: id === JOURNEY_MACHINE_ID ? 'The Scribe' : names[i], avatar_url: null, tent_house_id: null, correct_count: 0 }));
createRoot(document.getElementById('root')!).render(<main style={{ maxWidth: 1000, margin: 'auto', padding: 12 }}><JourneyGamePlay roomId="local-fixture" roomName="Elisha's Journey" userId="alpha" players={players} spectator={params.has('witness')} machine={machine} onExit={() => {}} /></main>);
