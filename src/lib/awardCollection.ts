import type { Award } from './types';

export const AWARD_CATEGORIES = {
  rhetoric: { label: 'Rhetoric Award (Orator)', meaning: 'Most reactions and comments on quotes and Bible insights that week.', cadence: 'Weekly' },
  angel: { label: 'Angel Award (Angelos)', meaning: 'Most insights published, meditations made public and app links shared that week.', cadence: 'Weekly' },
  rumor: { label: 'Rumor Award', meaning: 'Highest Marks among cadets that week.', cadence: 'Weekly' },
  scribe: { label: 'Scribe Award', meaning: 'Most Figs earned that week.', cadence: 'Weekly' },
  sprout: { label: 'The Sprout', meaning: 'Most improved cadet that week.', cadence: 'Weekly' },
  reputation: { label: 'Reputation Award', meaning: 'Best Sentry that week.', cadence: 'Weekly' },
  tutorix: { label: 'Tutorix', meaning: 'Sentry with the best quiz score and most quiz Figs that week.', cadence: 'Weekly' },
  valley_champion: { label: 'Valley Champion', meaning: 'Most Arena victories that week.', cadence: 'Weekly' },
  lords_secret: { label: 'Temple', meaning: 'Best performing tent that week.', cadence: 'Weekly · Tent award' },
  vallum: { label: 'Vallum', meaning: 'Cadet with the highest overall Marks that month.', cadence: 'Monthly' },
  nuncio: { label: 'Messenger Award (Nuncio)', meaning: 'Most insights published, meditations made public and app links shared that month.', cadence: 'Monthly' },
  monthly_scribe: { label: 'Monthly Scribe', meaning: 'Most Figs earned that month.', cadence: 'Monthly' },
  monthly_valley_champion: { label: 'Monthly Valley Champion', meaning: 'Most Arena victories that month.', cadence: 'Monthly' },
  muralis: { label: 'Muralis', meaning: 'Winner of the previous Full Circle Experience (FCX).', cadence: 'Monthly' },
  centurion: { label: 'Century Award (Centurion)', meaning: 'Best Sentry that month, based on attendance and meditation submissions.', cadence: 'Monthly' },
  bethel_stone: { label: 'Bethel Stone', meaning: 'Best performing tent that month.', cadence: 'Monthly · Tent award' },
  grand_vallum: { label: 'Grand Vallum', meaning: 'Highest overall Marks that year.', cadence: 'Annual' },
  grand_scribe: { label: 'Grand Scribe', meaning: 'Most Figs earned that year.', cadence: 'Annual' },
  grand_valley_champion: { label: 'Grand Valley Champion', meaning: 'Most Arena victories that year.', cadence: 'Annual' },
  grand_orator: { label: 'Grand Orator', meaning: 'Most Rhetoric Awards won that year.', cadence: 'Annual' },
  temple_mount: { label: 'Lumen Domus', meaning: 'Best performing tent that year.', cadence: 'Annual · Tent award' },
} as const;

type CategoryKey = keyof typeof AWARD_CATEGORIES;
const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const knownKeys = new Map<string, CategoryKey>();
for (const [key, category] of Object.entries(AWARD_CATEGORIES)) {
  knownKeys.set(normalize(key), key as CategoryKey);
  knownKeys.set(normalize(category.label), key as CategoryKey);
}
for (const [alias, key] of Object.entries({ 'orator': 'rhetoric', 'rhetoric award': 'rhetoric', 'messenger award': 'nuncio', 'angel award': 'angel', 'angelos': 'angel', 'best tent': 'bethel_stone', 'the lord s secret': 'lords_secret', 'century award': 'centurion', 'centurion': 'centurion', 'temple mount': 'temple_mount' })) {
  knownKeys.set(alias, key as CategoryKey);
}

export function awardCategoryKey(award: Pick<Award, 'title' | 'award_type'>) {
  // Recent releases store role (cadet/leadership/tent) in award_type.
  // The title, not that role, is the award identity.
  return knownKeys.get(normalize(award.title || '')) || knownKeys.get(normalize(award.award_type || '')) || `other:${normalize(award.title || award.award_type || 'award')}`;
}

export function isPersonalAward(award: Pick<Award, 'award_target_type' | 'user_id' | 'award_target_id'>, userId: string) {
  return !!userId && award.award_target_type !== 'tent' && (award.user_id === userId || award.award_target_id === userId);
}

export function buildAwardCategories(awards: Award[]) {
  const counts = new Map<string, number>();
  for (const award of awards) {
    const key = awardCategoryKey(award);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const categories = Object.entries(AWARD_CATEGORIES).map(([key, item]) => ({ key, ...item, count: counts.get(key) || 0 }));
  const custom = Array.from(counts).filter(([key]) => key.startsWith('other:')).map(([key, count]) => {
    const award = awards.find(item => awardCategoryKey(item) === key)!;
    return { key, label: award.title, count, cadence: 'Special honor', meaning: award.description?.trim() || 'A special honor you were awarded.' };
  });
  return [...categories, ...custom];
}
