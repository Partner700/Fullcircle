export type InterTentGroup = 'A' | 'B' | 'C' | 'D';
export type InterTentSide = { tent_id: string; tent_name: string; players: Array<{ id: string; name: string; player_number?: number | null }> };
export type InterTentFixture = {
  id: string; sequence: number; stage: 'group' | 'semi' | 'final'; group_key: InterTentGroup | null;
  leg: number; planned_at: string; room_id: string | null; room_status: string | null;
  journey_character_slug?: string | null; journey_secret?: boolean;
  sides: InterTentSide[]; result: Array<{ tent_id: string; points: number; score: number; answers: number }> | null;
};
export type InterTentChampionship = {
  id: string; title: string; status: 'draft' | 'scheduled' | 'playing' | 'completed';
  opening_at: string; fixtures: InterTentFixture[]; champion: string | null;
  standings: Array<{ user_id: string; name: string; tent_id: string; tent_name: string; matches: number; points: number; average: number }>;
  semifinal_standings: Array<{ user_id: string; name: string; tent_name: string; matches: number; points: number }>;
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
  const days = ['2026-11-24', '2026-11-26', '2026-12-01', '2026-12-03', '2026-12-08', '2026-12-10', '2026-12-15', '2026-12-17'];
  return days.flatMap((date, day) => {
    const groups: InterTentGroup[] = day % 2 === 0 ? ['A', 'B'] : ['C', 'D'];
    return groups.map((group, slot) => ({ group, leg: Math.floor(day / 2) + 1,
      startsAt: day===0&&slot===0?'2026-11-22T19:00:00+01:00':`${date}T18:${slot ? '30' : '00'}:00+01:00` }));
  });
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

export function interTentMatchLabel(fixture: Pick<InterTentFixture, 'sides' | 'stage'>): string {
  if (!fixture.sides.length) return fixture.stage === 'semi'
    ? 'Laurel #1 vs Spades #1 vs Square #1' : 'Semifinal #1 vs Semifinal #2';
  return fixture.sides.map((side) => side.players.map((player) => player.name).join(' & ')).join(' vs ');
}

export function interTentLegLabel(fixture: Pick<InterTentFixture, 'stage' | 'group_key' | 'leg'>): string {
  if (fixture.stage === 'final') return 'Grand final';
  const leg = fixture.leg % 2 ? 'Home' : 'Away';
  return fixture.stage === 'semi' ? `Semifinal · ${leg}` : `Group ${fixture.group_key} · Series ${Math.ceil(fixture.leg / 2)} · ${leg}`;
}
