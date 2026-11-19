export type InterTentGroup = 'A' | 'B' | 'C' | 'D';
export type InterTentSide = { tent_id: string; tent_name: string; players: Array<{ id: string; name: string; player_number?: number | null }> };
export type InterTentFixture = {
  id: string; sequence: number; stage: 'group' | 'semi' | 'final'; group_key: InterTentGroup | null;
  leg: number; planned_at: string; room_id: string | null; room_status: string | null;
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
      startsAt: `${date}T18:${slot ? '30' : '00'}:00+01:00` }));
  });
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
