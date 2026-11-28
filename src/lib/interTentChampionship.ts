export type InterTentGroup = 'A' | 'B' | 'C' | 'D';
export type InterTentSide = { tent_id: string; tent_name: string; players: Array<{ id: string; name: string; player_number?: number | null }> };
export type InterTentFixture = {
  id: string; sequence: number; stage: 'group' | 'semi' | 'final'; group_key: InterTentGroup | null;
  leg: number; planned_at: string; room_id: string | null; room_status: string | null;
  journey_character_slug?: string | null; journey_secret?: boolean;
  home_tent_id?: string | null; away_tent_id?: string | null;
  duel?: boolean;
  sides: InterTentSide[]; result: Array<{ tent_id: string; points: number; score: number; answers: number }> | null;
};
export type InterTentChampionship = {
  id: string; title: string; status: 'draft' | 'scheduled' | 'playing' | 'completed';
  duel?: boolean; finalist_tent_name?: string | null;
  opening_at: string; fixtures: InterTentFixture[]; champion: string | null;
  standings: Array<{ user_id: string; name: string; tent_id: string; tent_name: string; matches: number; points: number; average: number }>;
  semifinal_standings: Array<{ user_id: string; name: string; tent_id?: string; tent_name: string; matches: number; points: number }>;
  eligibility: Array<{ user_id: string; name: string; qualified: boolean }>;
  can_manage: boolean;
};

export const DAVID_GROUPS: Record<InterTentGroup, readonly string[]> = {
  A: ['Esther', 'Chwi😁', 'Verouchka Naomi', 'Rudy-Rasch'],
  B: ['Chwi😁', 'Megan Mah', 'Billy-Wesley', 'Gloire'],
  C: ['Esther', 'Verouchka Naomi', 'Rudy-Rasch', 'Gloire'],
  D: ['Chwi😁', 'Verouchka Naomi', 'Megan Mah', 'Rudy-Rasch'],
};

// Preserve the agreed start times in Cameroon, independent of a user's browser timezone.
export function davidFixturePlan() {
  const groups: InterTentGroup[] = ['A', 'B', 'C', 'D'];
  return Array.from({ length: 4 }, (_, week) => groups.map((group, day) => ({
    group, leg: week + 1,
    startsAt: `${new Date(Date.UTC(2026, 10, 24 + week * 7 + day)).toISOString().slice(0, 10)}T18:00:00+01:00`,
  }))).flat();
}

export function currentInterTentFixture(events: InterTentChampionship[], now = Date.now()) {
  const fixtures=events.filter(e=>e.status!=='completed').flatMap(event=>event.fixtures.map(fixture=>({event,fixture}))).filter(({fixture})=>!fixture.result&&!['cancelled','expired','completed'].includes(fixture.room_status||''));
  fixtures.sort((a,b)=>Date.parse(a.fixture.planned_at)-Date.parse(b.fixture.planned_at));
  return fixtures.find(({fixture})=>fixture.room_status==='playing')
    || fixtures.find(({fixture})=>fixture.room_status==='waiting'&&Date.parse(fixture.planned_at)<=now)
    || fixtures.find(({fixture})=>Date.parse(fixture.planned_at)>=now)
    || fixtures[0] || null;
}

export function interTentCountdown(plannedAt: string, now: number) {
  const remaining=Math.max(0,Math.ceil((Date.parse(plannedAt)-now)/1000));
  const days=Math.floor(remaining/86400),hours=Math.floor(remaining%86400/3600),minutes=Math.floor(remaining%3600/60),seconds=remaining%60;
  const clock=[hours,minutes,seconds].map(n=>String(n).padStart(2,'0')).join(':');
  return {remaining,text:days?`${days}d ${clock}`:clock};
}

export function interTentMatchLabel(fixture: Pick<InterTentFixture, 'sides' | 'stage' | 'duel'>): string {
  if(!fixture.sides.length&&fixture.duel)return fixture.stage==='semi'?'Second-place tent vs third-place tent':'Group leader vs semifinal winner';
  if (!fixture.sides.length) return fixture.stage === 'semi'
    ? 'Laurel #1 vs Spades #1 vs Square #1' : 'Semifinal #1 vs Semifinal #2';
  return fixture.sides.map((side) => side.players.map((player) => player.name).join(' & ')).join(' vs ');
}

export function interTentLegLabel(fixture: Pick<InterTentFixture, 'stage' | 'group_key' | 'leg' | 'home_tent_id'>): string {
  if (fixture.stage === 'final') return 'Grand final';
  if(fixture.home_tent_id&&fixture.stage==='group')return `1v1 · Meeting ${fixture.leg}`;
  // HOME/AWAY is determined by the number of players representing each tent
  // in this fixture, not by the odd/even match leg.
  return fixture.stage === 'semi' ? `Semifinal · Leg ${fixture.leg}` : `Group ${fixture.group_key} · Series ${Math.ceil(fixture.leg / 2)} · Leg ${fixture.leg}`;
}
