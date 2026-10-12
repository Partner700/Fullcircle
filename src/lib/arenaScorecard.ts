import type { ArenaFinalScorecard } from './queries';

type Player = ArenaFinalScorecard['players'][number];

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
    team.total += Math.max(0, Number(player.correct_count) || 0);
  }
  return Array.from(teams.values());
}
