export type OptimisticReactionActor = {
  user_id: string;
  display_name: string;
  avatar_url: string | null;
};

export type OptimisticReactionEntry = {
  count: number;
  reacted: boolean;
  actors?: OptimisticReactionActor[];
};

export type OptimisticReactionCollection = Record<string, Record<string, OptimisticReactionEntry>>;

export function updateReactionOptimistically(
  current: OptimisticReactionCollection,
  targetKey: string,
  reactionType: string,
  reacted: boolean,
  actor?: OptimisticReactionActor | null,
) {
  const target = current[targetKey] || {};
  const previous = target[reactionType] || { count: 0, reacted: false, actors: [] };
  if (previous.reacted === reacted) return current;

  const previousActors = previous.actors || [];
  const actors = !actor
    ? previousActors
    : reacted
      ? previousActors.some((item) => item.user_id === actor.user_id)
        ? previousActors
        : [actor, ...previousActors]
      : previousActors.filter((item) => item.user_id !== actor.user_id);

  return {
    ...current,
    [targetKey]: {
      ...target,
      [reactionType]: {
        ...previous,
        count: Math.max(0, Number(previous.count || 0) + (reacted ? 1 : -1)),
        reacted,
        actors,
      },
    },
  };
}
