import { ExternalLink, FileText, Image as ImageIcon, Trash2 } from 'lucide-react';
import type { ChallengeEvidenceItem } from '../lib/types';

function fileSizeLabel(bytes?: number) {
  if (!bytes || bytes < 1024) return bytes ? `${bytes} B` : '';
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function ChallengeEvidenceList({
  items,
  legacyText,
  onRemove,
}: {
  items: ChallengeEvidenceItem[];
  legacyText?: string | null;
  onRemove?: (id: string) => void;
}) {
  if (items.length === 0 && !legacyText) return null;

  return (
    <div className="space-y-2">
      {items.map((item) => {
        if (item.kind === 'text') {
          return (
            <div key={item.id} className="relative rounded-lg border border-border bg-surface-2 p-3 pr-10">
              <p className="preserve-paragraphs text-sm leading-relaxed text-ink">{item.content}</p>
              {onRemove && <RemoveEvidenceButton onClick={() => onRemove(item.id)} />}
            </div>
          );
        }

        if (item.kind === 'link') {
          return (
            <div key={item.id} className="relative rounded-lg border border-border bg-surface-2 p-3 pr-10">
              <a
                href={item.url}
                target="_blank"
                rel="noreferrer"
                className="flex min-w-0 items-center gap-2 text-sm font-medium text-brass hover:underline"
              >
                <ExternalLink size={15} className="flex-shrink-0" />
                <span className="truncate">{item.url}</span>
              </a>
              {onRemove && <RemoveEvidenceButton onClick={() => onRemove(item.id)} />}
            </div>
          );
        }

        const isImage = item.kind === 'image';
        return (
          <div key={item.id} className="relative overflow-hidden rounded-lg border border-border bg-surface-2">
            {isImage && item.preview_url ? (
              <a href={item.preview_url} target="_blank" rel="noreferrer" className="block">
                <img src={item.preview_url} alt={item.file_name || 'Challenge evidence'} className="h-40 w-full object-contain bg-black/5" />
              </a>
            ) : (
              <a
                href={item.preview_url}
                target={item.preview_url ? '_blank' : undefined}
                rel="noreferrer"
                className="flex min-h-24 items-center justify-center text-stone"
              >
                {isImage ? <ImageIcon size={30} /> : <FileText size={30} />}
              </a>
            )}
            <div className="flex min-w-0 items-center justify-between gap-3 border-t border-border px-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-xs font-semibold text-ink">{item.file_name || 'Evidence file'}</p>
                <p className="text-[10px] text-stone">{fileSizeLabel(item.size_bytes) || item.mime_type}</p>
              </div>
              {onRemove && (
                <button
                  type="button"
                  onClick={() => onRemove(item.id)}
                  className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md text-stone hover:bg-coral/10 hover:text-coral"
                  title="Remove evidence"
                >
                  <Trash2 size={15} />
                </button>
              )}
            </div>
          </div>
        );
      })}

      {items.length === 0 && legacyText && (
        <div className="rounded-lg border border-border bg-surface-2 p-3">
          <p className="preserve-paragraphs text-sm leading-relaxed text-ink">{legacyText}</p>
        </div>
      )}
    </div>
  );
}

function RemoveEvidenceButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-md text-stone hover:bg-coral/10 hover:text-coral"
      title="Remove evidence"
    >
      <Trash2 size={15} />
    </button>
  );
}
