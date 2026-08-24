import { CheckCircle2, AlertCircle, XCircle, Clock, Loader2, Circle, Ban, X } from 'lucide-react';
import type { PlatformDescriptor, PlatformSyncState, PlatformId } from '../../shared/types/index.js';

interface SyncProgressDetailProps {
  platforms: PlatformDescriptor[];
  syncStates: Partial<Record<PlatformId, PlatformSyncState>>;
  queuedPlatformIds?: PlatformId[];
  onCancelPlatform?: (platformId: PlatformId) => void;
}

type SyncProgressDisplayState = PlatformSyncState | 'idle';

const STATE_ICON: Record<SyncProgressDisplayState, React.ReactNode> = {
  idle: <Circle className="h-3 w-3 text-muted-foreground" />,
  pending: <Circle className="h-3 w-3 text-muted-foreground" />,
  running: <Loader2 className="h-3 w-3 text-primary animate-spin" />,
  success: <CheckCircle2 className="h-3 w-3 text-success" />,
  failed_login: <XCircle className="h-3 w-3 text-destructive" />,
  failed_2fa: <AlertCircle className="h-3 w-3 text-warning" />,
  failed_captcha: <AlertCircle className="h-3 w-3 text-warning" />,
  failed_timeout: <Clock className="h-3 w-3 text-muted-foreground" />,
  failed_extract: <AlertCircle className="h-3 w-3 text-warning" />,
  cancelled: <Ban className="h-3 w-3 text-muted-foreground" />,
};

const STATE_COLOR: Record<SyncProgressDisplayState, string> = {
  idle: 'text-muted-foreground',
  pending: 'text-muted-foreground',
  running: 'text-primary',
  success: 'text-success',
  failed_login: 'text-destructive',
  failed_2fa: 'text-warning',
  failed_captcha: 'text-warning',
  failed_timeout: 'text-muted-foreground',
  failed_extract: 'text-warning',
  cancelled: 'text-muted-foreground',
};

const STATE_LABEL: Record<SyncProgressDisplayState, string> = {
  idle: 'Idle',
  pending: 'Pending',
  running: 'Running',
  success: 'Done',
  failed_login: 'Login failed',
  failed_2fa: '2FA needed',
  failed_captcha: 'Captcha',
  failed_timeout: 'Timeout',
  failed_extract: 'Extraction failed',
  cancelled: 'Cancelled',
};

const STATE_ACCENT: Record<SyncProgressDisplayState, string> = {
  idle: 'border-border',
  pending: 'border-border',
  running: 'border-primary/40 ring-1 ring-primary/20',
  success: 'border-success/40',
  failed_login: 'border-destructive/40',
  failed_2fa: 'border-warning/40',
  failed_captcha: 'border-warning/40',
  failed_timeout: 'border-border',
  failed_extract: 'border-warning/40',
  cancelled: 'border-border',
};

const STATE_BADGE: Record<SyncProgressDisplayState, string> = {
  idle: 'bg-muted text-muted-foreground',
  pending: 'bg-muted text-muted-foreground',
  running: 'bg-primary text-primary-foreground',
  success: 'bg-success/15 text-success',
  failed_login: 'bg-destructive/10 text-destructive',
  failed_2fa: 'bg-warning/15 text-warning',
  failed_captcha: 'bg-warning/15 text-warning',
  failed_timeout: 'bg-muted text-muted-foreground',
  failed_extract: 'bg-warning/15 text-warning',
  cancelled: 'bg-muted text-muted-foreground',
};

export function SyncProgressDetail({
  platforms,
  syncStates,
  queuedPlatformIds = [],
  onCancelPlatform,
}: SyncProgressDetailProps) {
  return (
    <div className="flex flex-wrap gap-2 mt-2">
      {platforms.map((p, index) => {
        const syncState = syncStates[p.id];
        const queueIndex = queuedPlatformIds.indexOf(p.id);
        const isQueued = queueIndex !== -1;
        const state: SyncProgressDisplayState = syncState ?? (isQueued ? 'pending' : 'idle');
        const canCancel = onCancelPlatform && (isQueued || syncState === 'running' || syncState === 'pending');
        const statusLabel = isQueued ? `In Queue #${queueIndex + 1}` : STATE_LABEL[state];
        const badgeClass = isQueued ? STATE_BADGE.pending : STATE_BADGE[state];

        return (
          <span
            key={p.id}
            className={`inline-flex items-center gap-2 rounded-lg border bg-card px-2.5 py-1.5 text-xs shadow-sm ${STATE_ACCENT[state]}`}
            data-testid={`sync-progress-card-${p.id}`}
          >
            <span
              className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${badgeClass}`}
            >
              {index + 1}
            </span>
            {isQueued ? <Clock className="h-3 w-3 text-muted-foreground" /> : STATE_ICON[state]}
            <span className={`font-medium ${STATE_COLOR[state]}`}>{p.name}</span>
            <span className="text-muted-foreground">{statusLabel}</span>
            {canCancel && (
              <button
                type="button"
                onClick={() => onCancelPlatform(p.id)}
                className="rounded-md p-0.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                title={`Cancel ${p.name}`}
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </span>
        );
      })}
    </div>
  );
}
