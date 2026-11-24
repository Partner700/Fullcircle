import assert from 'node:assert/strict';
import { DAVID_GROUPS, davidFixturePlan, interTentMatchLabel, interTentLegLabel, interTentCountdown, currentInterTentFixture, type InterTentChampionship, type InterTentFixture } from '../src/lib/interTentChampionship.ts';
import { createJourneyGame, journeySameSide, resolveJourneyRoll, resolveJourneyMiss, LEGACY_JOURNEY_CONFIG } from '../supabase/functions/_shared/biblicalJourney.ts';

const plan = davidFixturePlan();
assert.equal(plan.length, 16);
assert.equal(new Set(Object.values(DAVID_GROUPS).flat()).size, 7);
assert(!Object.values(DAVID_GROUPS).flat().includes('PH'));
assert(!Object.values(DAVID_GROUPS).flat().includes('Linbaks'));
for (const group of Object.keys(DAVID_GROUPS)) {
  const fixtures = plan.filter((f) => f.group === group);
  assert.equal(fixtures.length, 4);
  assert.deepEqual(fixtures.map(f => f.leg), [1, 2, 3, 4]);
  for (let i=1;i<4;i++) if(group!=='A'||i!==1) assert.equal(Date.parse(fixtures[i].startsAt)-Date.parse(fixtures[i-1].startsAt), 7*86400000);
}
assert.equal(plan[0].startsAt,'2026-11-22T19:00:00+01:00');
assert.equal(plan[1].startsAt,'2026-11-24T18:30:00+01:00');
assert.equal(interTentCountdown(plan[0].startsAt,Date.parse(plan[0].startsAt)-90061000).text,'1d 01:01:01');
assert.equal(interTentCountdown(plan[0].startsAt,Date.parse(plan[0].startsAt)+1).remaining,0);
const fixture=(sequence:number,room_status:InterTentFixture['room_status'],result:InterTentFixture['result']=null)=>({id:String(sequence),sequence,stage:'group',group_key:'A',leg:1,planned_at:plan[sequence-1].startsAt,room_id:room_status?String(sequence):null,room_status,result,sides:[]} as InterTentFixture);
const event={id:'event',status:'scheduled',fixtures:[fixture(1,'waiting'),fixture(2,'waiting')]} as InterTentChampionship;
assert.equal(currentInterTentFixture([event],Date.parse(plan[0].startsAt)-1000)?.fixture.sequence,1);
event.fixtures[0].room_status='playing';assert.equal(currentInterTentFixture([event],Date.parse(plan[1].startsAt))?.fixture.sequence,1);
event.fixtures[0].room_status='completed';event.fixtures[0].result=[];assert.equal(currentInterTentFixture([event],Date.parse(plan[0].startsAt))?.fixture.sequence,2);
assert.equal(new Set(plan.map(f => f.startsAt)).size, 16);
assert.equal(interTentMatchLabel({ stage: 'group', sides: [
  {tent_id:'l',tent_name:'Laurel',players:[{id:'a',name:'Esther'},{id:'b',name:'Chwi'}]},
  {tent_id:'s',tent_name:'Spades',players:[{id:'c',name:'Verouchka'}]},
  {tent_id:'q',tent_name:'Square',players:[{id:'d',name:'Rudy'}]},
]}), 'Esther & Chwi vs Verouchka vs Rudy');
assert.equal(interTentLegLabel({stage:'group',group_key:'A',leg:4}), 'Group A · Series 2 · Leg 4');
const ordinary = createJourneyGame(['a','b','c']);
assert.equal(journeySameSide(ordinary,'a','b'), false);
const teamGame = createJourneyGame(['a','b','c','d'], {a:'laurel',b:'laurel',c:'spades',d:'square'});
assert.equal(journeySameSide(teamGame,'a','b'), true);
assert.equal(journeySameSide(teamGame,'a','c'), false);
assert.throws(() => createJourneyGame(['a','b','c'], {a:'l',b:'l'}));
delete teamGame.boardSpaces;
teamGame.players[0].location={route:'main',space:25};
teamGame.players[1].location={route:'main',space:40};
teamGame.players[2].location={route:'main',space:35};
teamGame.players[3].location={route:'main',space:15};
const swapped=resolveJourneyRoll(teamGame,'a',1,LEGACY_JOURNEY_CONFIG);
assert.deepEqual(swapped.players[0].location,{route:'main',space:35});
assert.deepEqual(swapped.players[1].location,{route:'main',space:40});
assert.deepEqual(swapped.players[2].location,{route:'main',space:26});
// One player starts immediately and keeps the turn until another selected player joins.
const solo = createJourneyGame(['first'], { first: 'laurels' });
assert.equal(solo.players.length, 1);
const soloAfterMiss = resolveJourneyMiss(solo, 'first');
assert.equal(soloAfterMiss.players[soloAfterMiss.turnIndex].id, 'first');
assert.equal(soloAfterMiss.status, 'playing');
// The database appends late entrants to the end of the Journey players array.
const joinedSecond = structuredClone(soloAfterMiss);
joinedSecond.players.push({ ...structuredClone(solo.players[0]), id: 'second' });
joinedSecond.tentSides = { ...joinedSecond.tentSides, second: 'spades' };
const secondTurn = resolveJourneyMiss(joinedSecond, 'first');
assert.equal(secondTurn.players[secondTurn.turnIndex].id, 'second');
const joinedThird = structuredClone(secondTurn);
joinedThird.players.push({ ...structuredClone(solo.players[0]), id: 'third' });
joinedThird.tentSides = { ...joinedThird.tentSides, third: 'squares' };
assert.equal(resolveJourneyMiss(joinedThird, 'second').players[2].id, 'third');
assert.equal(resolveJourneyMiss(joinedThird, 'second').players[resolveJourneyMiss(joinedThird, 'second').turnIndex].id, 'third');
assert.equal(resolveJourneyMiss(resolveJourneyMiss(joinedThird,'second'),'third').players[0].id, 'first');

console.log('Inter-tent fixtures and Journey side checks passed.');
