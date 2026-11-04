import type { TentOrder, TentPosition } from '../lib/tentPositions';

export function TentPositionControls({ order, setOrder, unavailable }: {
  order: TentOrder;
  setOrder: (order: TentOrder) => void;
  unavailable: boolean;
}) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Order cadets by tent position">
        {(['overall', 'weekly'] as const).map(option => (
          <button key={option} type="button" aria-pressed={order === option}
            className={order === option ? 'btn-primary text-xs' : 'btn-secondary text-xs'}
            onClick={() => setOrder(option)}>
            {option === 'overall' ? 'Overall' : 'This week'}
          </button>
        ))}
      </div>
      <p className="text-xs text-stone" role="status">
        {unavailable ? 'Tent positions are temporarily unavailable.' : order === 'overall'
          ? 'Ordered by overall Marks.'
          : 'Ordered by FIGS earned since Monday, Douala time.'}
      </p>
    </div>
  );
}

export function TentPositionBadges({ position }: { position?: TentPosition }) {
  if (!position) return null;
  return (
    <div className="my-1 flex flex-wrap gap-1.5">
      <span className="badge badge-brass text-[10px]">Overall #{position.overall_position}</span>
      <span className="badge badge-royal text-[10px]">This week #{position.weekly_position}</span>
    </div>
  );
}
