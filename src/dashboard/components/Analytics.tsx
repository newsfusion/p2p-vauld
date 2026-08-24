import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  DollarSign,
  Percent,
  TrendingDown,
  TrendingUp,
  Wallet,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { PlatformId, StoredOverviewMetrics } from "../../shared/types/index.js";
import {
  getMetricsHistoryAll,
  getPlatformAllocation,
  getCashflowSummary,
} from "../../shared/db/index.js";
import {
  buildDailyPortfolioSeries,
  calculateExposureTrendFromSnapshots,
  calculatePortfolioConcentration,
} from "../../shared/financial-metrics.js";
import {
  formatEur,
  formatEurCompactAxis,
  formatPercentValue,
  toDayLabel,
  toMonthLabel,
} from "../../shared/formatters.js";
import { getPlatformById } from "../../shared/platforms/index.js";

const CHART_COLORS = [
  "hsl(var(--chart-1))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
];

function chartColor(index: number): string {
  return CHART_COLORS[index % CHART_COLORS.length]!;
}

function toTooltipNumber(value: unknown): number {
  const rawValue = Array.isArray(value) ? value[0] : value;
  const numericValue = Number(rawValue ?? 0);
  return Number.isFinite(numericValue) ? numericValue : 0;
}

// ─── KPI Card ────────────────────────────────────────────────────────────────

interface KpiCardProps {
  title: string;
  value: string;
  subtitle?: string;
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  trend?: "up" | "down" | "neutral";
}

function KpiCard({ title, value, subtitle, icon: Icon, trend }: KpiCardProps) {
  return (
    <article className="glass-card p-6">
      <div className="mb-4 flex items-start justify-between">
        <span className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </span>
        <Icon className="h-5 w-5 text-primary" />
      </div>
      <div className="flex items-end gap-2">
        <span className="font-mono-nums text-2xl font-bold leading-none text-foreground">
          {value}
        </span>
        {trend === "up" && <TrendingUp className="mb-1 h-4 w-4 text-success" />}
        {trend === "down" && (
          <TrendingDown className="mb-1 h-4 w-4 text-destructive" />
        )}
      </div>
      {subtitle && (
        <p className="mt-3 text-xs text-muted-foreground">{subtitle}</p>
      )}
    </article>
  );
}

// ─── Analytics ───────────────────────────────────────────────────────────────

interface AnalyticsProps {
  metrics: StoredOverviewMetrics[];
  privacyMode: boolean;
  visiblePlatformIds?: PlatformId[];
}

interface AllocationEntry {
  platformId: PlatformId;
  name: string;
  totalValue: number;
}

interface CashflowEntry {
  period: string;
  interestEur: number;
  netContributionEur: number;
}

interface ExposureTrendEntry {
  date: string;
  exposurePct: number;
}

interface BalanceHistoryEntry {
  date: string;
  value: number;
}

interface MonthlyValueChangeEntry {
  period: string;
  valueChangeEur: number;
  interestEur: number;
}

type HistoryDays = 30 | 90 | 365 | 0;

const HISTORY_PERIODS: Array<{ label: string; days: HistoryDays }> = [
  { label: "30D", days: 30 },
  { label: "90D", days: 90 },
  { label: "365D", days: 365 },
  { label: "All", days: 0 },
];

export function Analytics({
  metrics,
  privacyMode,
  visiblePlatformIds,
}: AnalyticsProps) {
  const [historyDays, setHistoryDays] = useState<HistoryDays>(90);
  const [balanceHistory, setBalanceHistory] = useState<BalanceHistoryEntry[]>([]);
  const [allocation, setAllocation] = useState<AllocationEntry[]>([]);
  const [cashflow, setCashflow] = useState<CashflowEntry[]>([]);
  const [exposureTrend, setExposureTrend] = useState<ExposureTrendEntry[]>([]);

  useEffect(() => {
    let cancelled = false;
    getMetricsHistoryAll(historyDays, visiblePlatformIds).then(
      ({ snapshots, cutoffDate }) => {
        if (cancelled) return;
        const dailySeries = buildDailyPortfolioSeries(snapshots, cutoffDate);
        setExposureTrend(
          calculateExposureTrendFromSnapshots(
            snapshots,
            (platformId) =>
              getPlatformById(platformId as PlatformId)?.name ??
              String(platformId),
            cutoffDate,
          ).map((point) => ({
            date: point.date,
            exposurePct: point.exposurePct,
          })),
        );
        setBalanceHistory(
          dailySeries.map((point) => ({
            date: point.date,
            value: point.totalValue,
          })),
        );
      },
    );
    return () => {
      cancelled = true;
    };
  }, [historyDays, visiblePlatformIds]);

  useEffect(() => {
    let cancelled = false;
    getPlatformAllocation(visiblePlatformIds).then((nextAllocation) => {
      if (!cancelled) setAllocation(nextAllocation);
    });
    getCashflowSummary(12, visiblePlatformIds).then((nextCashflow) => {
      if (!cancelled) setCashflow(nextCashflow);
    });
    return () => {
      cancelled = true;
    };
  }, [visiblePlatformIds]);

  const fmt = (v: number) => formatEur(v, privacyMode);
  const fmtAxis = (v: number) => formatEurCompactAxis(v, privacyMode);

  // ── Derived data ──

  const totalValue = metrics.reduce((sum, m) => sum + m.platformValue, 0);
  const totalCash = metrics.reduce((sum, m) => sum + m.freeCash, 0);
  const avgReturnMetrics = metrics.filter(
    (metric) =>
      metric.netAnnualReturnPct !== undefined && metric.platformValue > 0,
  );
  const avgReturnWeight = avgReturnMetrics.reduce(
    (sum, metric) => sum + metric.platformValue,
    0,
  );
  const avgReturn =
    avgReturnWeight > 0
      ? avgReturnMetrics.reduce(
          (sum, metric) =>
            sum + (metric.netAnnualReturnPct ?? 0) * metric.platformValue,
          0,
        ) / avgReturnWeight
      : undefined;

  const wealthDelta = useMemo(() => {
    if (balanceHistory.length < 2) return undefined;
    const prev = balanceHistory[balanceHistory.length - 2]!.value;
    const curr = balanceHistory[balanceHistory.length - 1]!.value;
    return prev !== 0 ? (curr - prev) / prev : undefined;
  }, [balanceHistory]);

  const diversificationData = useMemo(() => {
    const total = allocation.reduce((sum, a) => sum + a.totalValue, 0);
    if (total <= 0) return [];
    return allocation.map((a, i) => ({
      name: a.name,
      value: Number(((a.totalValue / total) * 100).toFixed(1)),
      color: chartColor(i),
    }));
  }, [allocation]);

  const totalInterest = cashflow.reduce((sum, r) => sum + r.interestEur, 0);
  const monthlyAvgInterest =
    cashflow.length > 0 ? totalInterest / cashflow.length : 0;
  const monthlyValueChanges = useMemo<MonthlyValueChangeEntry[]>(() => {
    const lastValueByMonth = new Map<string, number>();
    for (const point of balanceHistory) {
      lastValueByMonth.set(point.date.slice(0, 7), point.value);
    }
    const interestByMonth = new Map(
      cashflow.map((entry) => [entry.period, entry.interestEur]),
    );
    const monthlyValues = [...lastValueByMonth.entries()].sort(([a], [b]) =>
      a.localeCompare(b),
    );

    return monthlyValues.slice(1).map(([period, value], index) => ({
      period,
      valueChangeEur: value - monthlyValues[index]![1],
      interestEur: interestByMonth.get(period) ?? 0,
    }));
  }, [balanceHistory, cashflow]);
  const concentration = useMemo(
    () =>
      calculatePortfolioConcentration(
        metrics.map((m) => ({
          platformId: m.platformId,
          name: getPlatformById(m.platformId)?.name ?? m.platformId,
          totalValue: m.platformValue,
        })),
      ),
    [metrics],
  );
  const exposureValue = privacyMode
    ? "**%"
    : `${concentration.topPlatformSharePct.toFixed(1)}%`;
  const exposureSubtitle = concentration.topPlatform
    ? `${concentration.topPlatform.name} · ${fmt(concentration.topPlatformValue)} allocated`
    : "No platform allocation available";
  const foreignCurrencyPlatforms = useMemo(
    () =>
      [
        ...new Set(
          metrics
            .filter((metric) => metric.currency.trim().toUpperCase() !== "EUR")
            .map(
              (metric) =>
                getPlatformById(metric.platformId)?.name ?? metric.platformId,
            ),
        ),
      ],
    [metrics],
  );

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
      {/* Header */}
      <div className="mb-2">
        <h1 className="text-3xl font-bold leading-tight tracking-tight text-foreground md:text-4xl">
          Analytics Dashboard
        </h1>
        <p className="mt-2 text-base leading-relaxed text-muted-foreground">
          Real-time performance monitoring and risk evaluation of your aggregated P2P assets.
        </p>
      </div>

      {foreignCurrencyPlatforms.length > 0 && (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-foreground"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <p>
            Values from {foreignCurrencyPlatforms.join(", ")} are not in EUR and
            are summed without currency conversion.
          </p>
        </div>
      )}

      {/* KPI Cards */}
      <section className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          title="Portfolio Value"
          icon={Wallet}
          value={fmt(totalValue)}
          trend={
            wealthDelta === undefined
              ? "neutral"
              : wealthDelta >= 0
                ? "up"
                : "down"
          }
          subtitle={
            wealthDelta !== undefined
              ? `${privacyMode || wealthDelta < 0 ? "" : "+"}${
                  privacyMode
                    ? formatPercentValue(wealthDelta * 100, true)
                    : `${(wealthDelta * 100).toFixed(1)}%`
                } vs previous day`
              : "No history available"
          }
        />
        <KpiCard
          title="Avg Return"
          icon={Percent}
          value={
            avgReturn === undefined
              ? "—"
              : formatPercentValue(avgReturn, privacyMode)
          }
          trend={
            avgReturn === undefined
              ? "neutral"
              : avgReturn >= 0
                ? "up"
                : "down"
          }
          subtitle="Weighted net annual return"
        />
        <KpiCard
          title="Free Cash"
          icon={DollarSign}
          value={fmt(totalCash)}
          trend="neutral"
          subtitle="Available across platforms"
        />
        <KpiCard
          title="Largest Platform Exposure"
          icon={AlertTriangle}
          value={exposureValue}
          trend={
            concentration.status === "healthy"
              ? "up"
              : concentration.status === "watch"
                ? "neutral"
                : "down"
          }
          subtitle={exposureSubtitle}
        />
      </section>

      {/* Charts Row 1: Wealth + Diversification */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Wealth Development */}
        <article className="glass-card p-6 lg:col-span-2">
          <div className="mb-6 flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
            <div>
              <h3 className="text-2xl font-semibold tracking-tight text-foreground">
                Wealth Development
              </h3>
              <p className="mt-1 text-sm font-medium text-muted-foreground">
                Portfolio growth over available history
              </p>
            </div>
            <div
              role="group"
              aria-label="Analytics history period"
              className="flex flex-wrap gap-1 rounded-lg bg-muted p-1"
            >
              {HISTORY_PERIODS.map((period) => (
                <button
                  key={period.label}
                  type="button"
                  aria-pressed={historyDays === period.days}
                  onClick={() => setHistoryDays(period.days)}
                  className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                    historyDays === period.days
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {period.label}
                </button>
              ))}
            </div>
          </div>
          <div className="h-[280px] w-full min-w-0">
            {balanceHistory.length > 0 ? (
              <ResponsiveContainer width="100%" height={280} minWidth={0}>
                <AreaChart data={balanceHistory}>
                  <defs>
                    <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop
                        offset="0%"
                        stopColor="hsl(var(--primary))"
                        stopOpacity={0.3}
                      />
                      <stop
                        offset="100%"
                        stopColor="hsl(var(--primary))"
                        stopOpacity={0}
                      />
                    </linearGradient>
                  </defs>
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 11 }}
                    stroke="hsl(var(--muted-foreground))"
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={toDayLabel}
                  />
                  <YAxis
                    tick={{ fontSize: 11 }}
                    stroke="hsl(var(--muted-foreground))"
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v) => fmtAxis(Number(v))}
                  />
                  <Tooltip
                    contentStyle={{
                      border: "1px solid hsl(var(--border))",
                      borderRadius: 12,
                      boxShadow: "0 4px 12px rgba(15, 23, 42, 0.06)",
                    }}
                    formatter={(value: unknown) => fmt(toTooltipNumber(value))}
                  />
                  <Area
                    type="monotone"
                    dataKey="value"
                    stroke="hsl(var(--primary))"
                    strokeWidth={2}
                    fill="url(#areaGrad)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground">
                <TrendingUp className="h-10 w-10 rounded-full bg-accent p-2 text-muted-foreground" />
                <span>No data available for display</span>
              </div>
            )}
          </div>
        </article>

        {/* Platform Diversification */}
        <article className="glass-card p-6">
          <h3 className="mb-6 text-2xl font-semibold tracking-tight text-foreground">
            Platform Diversification
          </h3>
          <div className="h-[200px] w-full min-w-0">
            {diversificationData.length > 0 ? (
              <ResponsiveContainer width="100%" height={200} minWidth={0}>
                <PieChart>
                  <Pie
                    data={diversificationData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={55}
                    outerRadius={80}
                    strokeWidth={2}
                    stroke="hsl(var(--background))"
                  >
                    {diversificationData.map((entry) => (
                      <Cell key={entry.name} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      border: "1px solid hsl(var(--border))",
                      borderRadius: 12,
                      boxShadow: "0 4px 12px rgba(15, 23, 42, 0.06)",
                    }}
                    formatter={(value: unknown) =>
                      privacyMode ? "**%" : `${toTooltipNumber(value)}%`
                    }
                  />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground">
                <Wallet className="h-10 w-10 rounded-full bg-accent p-2 text-muted-foreground" />
                <span>No data available for display</span>
              </div>
            )}
          </div>
          {diversificationData.length > 0 && (
            <div className="mt-4 space-y-3">
              {diversificationData.map((slice) => (
                <div
                  key={slice.name}
                  className="flex items-center justify-between text-sm"
                >
                  <div className="flex items-center gap-2">
                    <span
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: slice.color }}
                    />
                    <span className="text-muted-foreground">{slice.name}</span>
                  </div>
                  <span className="font-mono-nums font-bold text-foreground">
                    {privacyMode ? "**%" : `${slice.value}%`}
                  </span>
                </div>
              ))}
            </div>
          )}
        </article>
      </section>

      {/* Charts Row 2: Value change + concentration */}
      <section className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        {/* Monthly Value Change */}
        <article className="glass-card p-6">
          <h3 className="mb-6 text-2xl font-semibold tracking-tight text-foreground">
            Monthly Value Change
          </h3>
          <div className="h-[280px] w-full min-w-0">
            {monthlyValueChanges.length > 0 ? (
              <ResponsiveContainer width="100%" height={280} minWidth={0}>
                <BarChart data={monthlyValueChanges}>
                  <CartesianGrid
                    stroke="hsl(var(--border))"
                    strokeDasharray="3 3"
                  />
                  <XAxis
                    dataKey="period"
                    tick={{ fontSize: 11 }}
                    tickFormatter={toMonthLabel}
                  />
                  <YAxis
                    tickFormatter={(v) => fmtAxis(Number(v))}
                    tick={{ fontSize: 11 }}
                  />
                  <Tooltip
                    contentStyle={{
                      border: "1px solid hsl(var(--border))",
                      borderRadius: 12,
                      boxShadow: "0 4px 12px rgba(15, 23, 42, 0.06)",
                    }}
                    formatter={(value: unknown) => fmt(toTooltipNumber(value))}
                  />
                  <Legend />
                  <Bar
                    dataKey="valueChangeEur"
                    name="Value Change"
                    radius={[4, 4, 0, 0]}
                  >
                    {monthlyValueChanges.map((entry) => (
                      <Cell
                        key={entry.period}
                        fill={
                          entry.valueChangeEur >= 0
                            ? "hsl(var(--success))"
                            : "hsl(var(--destructive))"
                        }
                      />
                    ))}
                  </Bar>
                  {cashflow.length > 0 && (
                    <Bar
                      dataKey="interestEur"
                      name="Interest"
                      fill="hsl(var(--chart-1))"
                      radius={[4, 4, 0, 0]}
                    />
                  )}
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground">
                <DollarSign className="h-10 w-10 rounded-full bg-accent p-2 text-muted-foreground" />
                <span>No data available for display</span>
              </div>
            )}
          </div>
        </article>

        {/* Exposure Trend */}
        <article className="glass-card p-6">
          <h3 className="mb-6 text-2xl font-semibold tracking-tight text-foreground">
            Exposure Trend
          </h3>
          <div className="h-[280px] w-full min-w-0">
            {exposureTrend.length > 0 ? (
              <ResponsiveContainer width="100%" height={280} minWidth={0}>
                <LineChart data={exposureTrend}>
                  <CartesianGrid
                    stroke="hsl(var(--border))"
                    strokeDasharray="3 3"
                  />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 11 }}
                    tickFormatter={toDayLabel}
                  />
                  <YAxis
                    tickFormatter={(v) =>
                      privacyMode ? "**%" : `${Number(v).toFixed(0)}%`
                    }
                    tick={{ fontSize: 11 }}
                    domain={[0, 100]}
                  />
                  <Tooltip
                    contentStyle={{
                      border: "1px solid hsl(var(--border))",
                      borderRadius: 12,
                      boxShadow: "0 4px 12px rgba(15, 23, 42, 0.06)",
                    }}
                    formatter={(
                      value: unknown,
                      name: unknown,
                    ) => [
                      privacyMode
                        ? "**%"
                        : `${toTooltipNumber(value).toFixed(1)}%`,
                      typeof name === "string" ? name : "Exposure",
                    ]}
                  />
                  <Legend />
                  <ReferenceLine
                    y={30}
                    stroke="hsl(var(--warning))"
                    strokeDasharray="4 4"
                    label="30% target"
                  />
                  <Line
                    type="monotone"
                    dataKey="exposurePct"
                    name="Largest Platform Share"
                    stroke="hsl(var(--primary))"
                    strokeWidth={2}
                    dot={{ r: 3 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground">
                <AlertTriangle className="h-10 w-10 rounded-full bg-accent p-2 text-muted-foreground" />
                <span>No data available for display</span>
              </div>
            )}
          </div>
        </article>
      </section>

      {/* Summary Cards */}
      <section className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
        <article className="glass-card p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Effective Platforms
          </p>
          <p className="mt-3 font-mono-nums text-xl font-bold text-foreground">
            {concentration.effectivePlatformCount.toFixed(1)}
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            HHI {concentration.hhi.toFixed(0)}
          </p>
        </article>
        <article className="glass-card p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Total Interest
          </p>
          <p className="mt-3 font-mono-nums text-xl font-bold text-foreground">
            {cashflow.length > 0 ? fmt(totalInterest) : "—"}
          </p>
        </article>
        <article className="glass-card p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Monthly Avg Interest
          </p>
          <p className="mt-3 font-mono-nums text-xl font-bold text-foreground">
            {cashflow.length > 0 ? fmt(monthlyAvgInterest) : "—"}
          </p>
        </article>
        <article className="glass-card p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Excess Concentration
          </p>
          <p className="mt-3 font-mono-nums text-xl font-bold text-foreground">
            {fmt(concentration.excessConcentrationEur)}
          </p>
        </article>
      </section>
    </div>
  );
}
