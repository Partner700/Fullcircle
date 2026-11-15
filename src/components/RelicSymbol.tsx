import {
  BookOpen, Clock3, Coins, Cross, Eye, Lightbulb, ListFilter, MessageSquare,
  Shield, SkipForward, Sparkles, Swords, TimerReset, Trophy, Wallet,
} from 'lucide-react';

const symbols = {
  'hezekiahs-sundial': Clock3,
  'witch-ball-endor': Eye,
  'reveal-reference': BookOpen,
  'freeze-timer': TimerReset,
  'sword-goliath': Swords,
  'talking-donkey': MessageSquare,
  'simons-purse': Wallet,
  'thieves-request': Cross,
  'masters-reward': Trophy,
  'lazarus-coin': Coins,
  'redemption-coin': Coins,
  'simons-coin': Wallet,
  'shield-of-faith': Shield,
  hint: Lightbulb,
  eliminate: ListFilter,
  skip: SkipForward,
} as const;

export function RelicSymbol({ slug, size = 16 }: { slug: string; size?: number }) {
  const Icon = symbols[slug as keyof typeof symbols] ?? Sparkles;
  return <Icon size={size} aria-hidden="true" />;
}
