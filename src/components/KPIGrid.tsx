import { ArrowUpRight, ArrowDownRight, Activity, Hospital, Users, FileText, ArrowRightLeft } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { DashboardMetrics } from '../types';
import { formatNumber } from '../lib/utils';
import { cn } from '../lib/utils';

interface KPIGridProps {
    metrics?: DashboardMetrics;
    loading: boolean;
    trendLabel?: string;
}

const TrendBadge = ({ value }: { value: number }) => (
    <div className={cn(
        "flex items-center gap-1 font-medium px-1.5 py-0.5 rounded transition-dashboard",
        value > 0 ? "text-semantic-success bg-semantic-success/10" : value < 0 ? "text-semantic-danger bg-semantic-danger/10" : "text-fg-muted bg-fg-muted/10"
    )}>
        {value > 0 ? <ArrowUpRight className="h-3 w-3" /> : value < 0 ? <ArrowDownRight className="h-3 w-3" /> : null}
        {Math.abs(value)}%
    </div>
);

interface KPICardProps {
    label: string;
    value: string;
    subtext?: string;
    icon: LucideIcon;
    trendMoM?: number;
    trendYoY?: number;
    trendDeltaMoM?: number;
    trendDeltaYoY?: number;
}

const formatSignedDelta = (value: number) => {
    if (value === 0) return '0';
    return `${value > 0 ? '+' : '-'}${formatNumber(Math.abs(value))}`;
};

const deltaTextColor = (value: number) => {
    if (value > 0) return 'text-semantic-success';
    if (value < 0) return 'text-semantic-danger';
    return 'text-fg-muted';
};

const KPICard = ({ label, value, subtext, icon: Icon, trendMoM, trendYoY, trendDeltaMoM, trendDeltaYoY }: KPICardProps) => (
    <div className="bg-brand-card border border-subtle rounded-xl p-3 sm:p-6 hover:border-brand-accent/35 hover:bg-brand-card-hover/40 transition-dashboard group min-h-[118px] sm:min-h-[160px] flex flex-col justify-between shadow-card">
        <div>
            <div className="flex items-center justify-between mb-2 sm:mb-4">
                <div className="p-1.5 sm:p-2 bg-brand-card-hover rounded-lg text-brand-secondary group-hover:text-brand-accent group-hover:bg-brand-accent/10 transition-dashboard">
                    <Icon className="h-4 w-4 sm:h-5 sm:w-5" />
                </div>
            </div>
            <div className="space-y-0.5 sm:space-y-1">
                <h3 className="text-xs sm:text-sm font-medium text-fg-muted">{label}</h3>
                <p className="text-lg sm:text-2xl font-bold text-fg-primary tracking-tight">{value}</p>
            </div>
        </div>

        <div className="flex flex-col gap-1 mt-2 sm:mt-4 pt-2 sm:pt-4 border-t border-subtle">
            {trendMoM !== undefined && (
                <div className="flex items-center gap-1.5 text-[11px] sm:text-xs min-w-0">
                    <div className="flex items-center gap-1.5 min-w-0">
                        <TrendBadge value={trendMoM} />
                        <span className="text-fg-muted">vs Prev</span>
                    </div>
                    {trendDeltaMoM !== undefined && (
                        <span className={cn("ml-auto font-mono text-[11px] sm:text-xs shrink-0", deltaTextColor(trendDeltaMoM))}>
                            {formatSignedDelta(trendDeltaMoM)}
                        </span>
                    )}
                </div>
            )}
            {trendYoY !== undefined && (
                <div className="flex items-center gap-1.5 text-[11px] sm:text-xs min-w-0">
                    <div className="flex items-center gap-1.5 min-w-0">
                        <TrendBadge value={trendYoY} />
                        <span className="text-fg-muted">vs LY</span>
                    </div>
                    {trendDeltaYoY !== undefined && (
                        <span className={cn("ml-auto font-mono text-[11px] sm:text-xs shrink-0", deltaTextColor(trendDeltaYoY))}>
                            {formatSignedDelta(trendDeltaYoY)}
                        </span>
                    )}
                </div>
            )}
            {subtext && !trendMoM && !trendYoY && (
                <p className="text-[11px] sm:text-xs text-fg-muted">{subtext}</p>
            )}
        </div>
    </div>
);

export const KPIGrid = ({ metrics, loading }: KPIGridProps) => {
    if (loading) {
        return <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3 sm:gap-4 animate-pulse">
            {[...Array(5)].map((_, i) => (
                <div key={i} className="h-32 sm:h-40 bg-brand-card/50 rounded-xl border border-subtle" />
            ))}
        </div>;
    }

    if (!metrics) return null;
    const utilization = metrics.totalHospitals > 0
        ? ((metrics.activeHospitals / metrics.totalHospitals) * 100).toFixed(1)
        : '0.0';

    return (
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3 sm:gap-4">
            <KPICard
                label="Total Consults"
                value={formatNumber(metrics.totalConsults)}
                icon={FileText}
                trendMoM={metrics.consultsTrendMoM}
                trendYoY={metrics.consultsTrendYoY}
                trendDeltaMoM={metrics.consultsDeltaMoM}
                trendDeltaYoY={metrics.consultsDeltaYoY}
            />
            <KPICard
                label="Total Transfers"
                value={formatNumber(metrics.totalTransfers)}
                icon={ArrowRightLeft}
                trendMoM={metrics.transfersTrendMoM}
                trendYoY={metrics.transfersTrendYoY}
                trendDeltaMoM={metrics.transfersDeltaMoM}
                trendDeltaYoY={metrics.transfersDeltaYoY}
            />
            <KPICard
                label="Total Hospitals"
                value={formatNumber(metrics.totalHospitals)}
                icon={Hospital}
            />
            <KPICard
                label="Active Hospitals"
                value={formatNumber(metrics.activeHospitals)}
                icon={Activity}
                trendMoM={metrics.activeHospitalsTrendMoM}
                trendYoY={metrics.activeHospitalsTrendYoY}
                trendDeltaMoM={metrics.activeHospitalsDeltaMoM}
                trendDeltaYoY={metrics.activeHospitalsDeltaYoY}
                subtext={`${utilization}% Utilization`}
            />
            <KPICard
                label="Inactive Hospitals"
                value={formatNumber(metrics.inactiveHospitals)}
                icon={Users}
                trendMoM={metrics.inactiveHospitalsTrendMoM}
                trendYoY={metrics.inactiveHospitalsTrendYoY}
                trendDeltaMoM={metrics.inactiveHospitalsDeltaMoM}
                trendDeltaYoY={metrics.inactiveHospitalsDeltaYoY}
            />
        </div>
    );
};
