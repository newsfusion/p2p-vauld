import { Wallet, DollarSign, Percent, TrendingUp } from 'lucide-react';
import { formatEur, formatPercentValue } from '../../shared/formatters.js';

interface PortfolioHeaderProps {
  totalValue: number;
  totalCash: number;
  avgReturn: number | null;
  privacyMode: boolean;
  isSyncing: boolean;
  hasConfiguredPlatforms: boolean;
}

export function PortfolioHeader({
  totalValue,
  totalCash,
  avgReturn,
  privacyMode,
  isSyncing,
  hasConfiguredPlatforms,
}: PortfolioHeaderProps) {
  const totalCapital = totalValue + totalCash;
  const investedShare = totalCapital > 0 ? (totalValue / totalCapital) * 100 : 0;
  const freeCashShare = totalCapital > 0 ? (totalCash / totalCapital) * 100 : 0;
  const statusMessage = isSyncing
    ? "Syncing platforms..."
    : !hasConfiguredPlatforms
      ? "Add credentials in Settings to enable sync."
      : "";

  return (
    <section className="mb-8">
      <div className="mb-10">
        <div>
          <h1 className="text-3xl font-bold leading-tight tracking-tight text-foreground md:text-4xl">
            Portfolio Overview
          </h1>
          <p className="mt-2 text-base leading-relaxed text-muted-foreground">
            Real-time performance metrics across all integrated platforms.
          </p>
        </div>
      </div>

      <div className="mb-8 grid grid-cols-1 gap-6 md:grid-cols-3">
        {/* Total Value */}
        <div className="glass-card p-6 transition-shadow hover:shadow-md">
          <div className="mb-5 flex items-center justify-between">
            <p className="text-sm font-semibold text-muted-foreground">Total Value</p>
            <Wallet className="h-5 w-5 text-primary" />
          </div>
          <p className="font-mono-nums text-3xl font-bold leading-none text-foreground">
            {formatEur(totalCapital, privacyMode)}
          </p>
          <div className="mt-5 h-1.5 overflow-hidden rounded-full bg-accent">
            <div
              className="h-full rounded-full bg-primary"
              style={{ width: `${Math.min(100, Math.max(0, investedShare))}%` }}
            />
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs font-semibold text-muted-foreground">
            <span>
              {privacyMode ? '**%' : `${investedShare.toFixed(1)}%`} invested
            </span>
            <span aria-hidden="true">·</span>
            <span>{formatEur(totalValue, privacyMode)} Portfolio Value</span>
          </div>
        </div>

        {/* Free Cash */}
        <div className="glass-card p-6 transition-shadow hover:shadow-md">
          <div className="mb-5 flex items-center justify-between">
            <p className="text-sm font-semibold text-muted-foreground">Free Cash</p>
            <DollarSign className="h-5 w-5 text-success" />
          </div>
          <p className="font-mono-nums text-3xl font-bold leading-none text-foreground">
            {formatEur(totalCash, privacyMode)}
          </p>
          <div className="mt-5 text-xs font-semibold text-muted-foreground">
            {privacyMode ? '**%' : `${freeCashShare.toFixed(1)}%`} free cash
          </div>
        </div>

        {/* Avg Net Return */}
        <div className="glass-card p-6 transition-shadow hover:shadow-md">
          <div className="mb-5 flex items-center justify-between">
            <p className="text-sm font-semibold text-muted-foreground">Avg. Net Return</p>
            <Percent className="h-5 w-5 text-warning" />
          </div>
          <p className="font-mono-nums text-3xl font-bold leading-none text-foreground">
            {avgReturn !== null ? (
              formatPercentValue(avgReturn, privacyMode)
            ) : (
              <span className="text-muted-foreground text-base font-normal">No data</span>
            )}
          </p>
          <div className="mt-5 flex items-center gap-2 text-xs text-muted-foreground">
            <TrendingUp className="h-4 w-4 text-warning" />
            <span>
              {avgReturn !== null
                ? 'Calculated weighted average across platforms.'
                : 'Connect platforms to calculate returns.'}
            </span>
          </div>
        </div>
      </div>

      <p className="min-h-5 text-sm text-muted-foreground" aria-live="polite">
        {statusMessage}
      </p>
    </section>
  );
}
