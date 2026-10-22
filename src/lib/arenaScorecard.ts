import type { ArenaFinalScorecard } from './queries';

type Player = ArenaFinalScorecard['players'][number];

export function arenaPlayerScore(player?: { score?: number; correct_count: number }): number {
  return Number(player?.score ?? player?.correct_count) || 0;
}

export function shortestArenaName(displayName: string): string {
  if (displayName.trim().toLowerCase() === 'the scribe') return 'The Scribe';
  const names = displayName.trim().split(/[\s-]+/).filter(Boolean);
  if (names.length === 0) return 'Player';
  return names.reduce((shortest, name) => name.length < shortest.length ? name : shortest);
}

export type ArenaScoreTeam = {
  key: string;
  name: string;
  houseId: string | null;
  players: Player[];
  total: number;
};

export function groupArenaScoreTeams(players: Player[]): ArenaScoreTeam[] {
  const teams = new Map<string, ArenaScoreTeam>();
  for (const player of players) {
    const key = player.tent_id || player.user_id;
    let team = teams.get(key);
    if (!team) {
      team = {
        key,
        name: player.tent_name || (player.display_name === 'The Scribe' ? 'The Scribe' : 'Independent'),
        houseId: player.tent_house_id,
        players: [],
        total: 0,
      };
      teams.set(key, team);
    }
    team.players.push(player);
    team.total += arenaPlayerScore(player);
  }
  return Array.from(teams.values());
}
