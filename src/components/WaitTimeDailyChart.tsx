import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { WaitTimeDailyPoint } from '../types';
import { formatQueryError } from '../lib/utils';
import { useFullscreenFrame } from './FullscreenFrame';
import { chartTheme } from '../lib/chartTheme';

interface WaitTimeDailyChartProps {
    data?: WaitTimeDailyPoint[];
    loading: boolean;
    error?: Error | null;
}

const formatMinutes = (value: number) => {
    if (value >= 60) {
        const hours = Math.floor(value / 60);
        const mins = Math.round(value % 60);
        return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
    }
    return `${Math.round(value)}m`;
};

export const WaitTimeDailyChart = ({ data, loading, error }: WaitTimeDailyChartProps) => {
    const isFullscreen = useFullscreenFrame();
    const chartHeightClass = isFullscreen ? 'h-[65vh] sm:h-[72vh]' : 'h-[250px] sm:h-[300px]';

    if (loading) {
        return <div className={`${chartHeightClass} w-full bg-brand-card/50 rounded-xl border border-subtle animate-pulse`} />;
    }

    if (error) {
        return (
            <div className={`${chartHeightClass} w-full bg-brand-card border border-semantic-danger/30 rounded-xl flex items-center justify-center px-4 text-center`}>
                <p className="text-sm text-semantic-danger">
                    Could not load wait time by day: {formatQueryError(error)}
                </p>
            </div>
        );
    }

    if (!data || data.length === 0) {
        return (
            <div className={`${chartHeightClass} w-full bg-brand-card border border-subtle rounded-xl flex items-center justify-center text-fg-muted text-sm sm:text-base`}>
                No wait time data available for this period
            </div>
        );
    }

    return (
        <div className="bg-brand-card border border-subtle rounded-xl p-4 sm:p-6 shadow-card">
            <div className="mb-4 sm:mb-6">
                <h3 className="text-base sm:text-lg font-medium text-fg-primary">Average Wait Time by Day</h3>
                <p className="text-xs text-fg-muted mt-1">Claimed at minus consult date/time when present, otherwise created date.</p>
            </div>
            <div className={`${chartHeightClass} w-full`}>
                <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={data}>
                        <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} vertical={false} />
                        <XAxis
                            dataKey="date"
                            stroke={chartTheme.axis}
                            fontSize={11}
                            tickLine={false}
                            axisLine={false}
                            interval="preserveStartEnd"
                            minTickGap={24}
                            tickFormatter={(value) => new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                        />
                        <YAxis
                            stroke={chartTheme.axis}
                            fontSize={12}
                            tickLine={false}
                            axisLine={false}
                            tickFormatter={(value) => formatMinutes(Number(value))}
                        />
                        <Tooltip
                            contentStyle={{ backgroundColor: chartTheme.bg, borderColor: chartTheme.primary, color: chartTheme.tooltipFg }}
                            itemStyle={{ color: chartTheme.tooltipFg }}
                            labelFormatter={(label) =>
                                new Date(label).toLocaleDateString(undefined, {
                                    weekday: 'long',
                                    year: 'numeric',
                                    month: 'long',
                                    day: 'numeric'
                                })
                            }
                            formatter={(value: unknown) => [`${Number(value).toFixed(1)} min`, 'Avg Wait']}
                        />
                        <Line
                            type="monotone"
                            dataKey="avgWaitMinutes"
                            stroke={chartTheme.primary}
                            strokeWidth={2.5}
                            dot={false}
                            activeDot={{ r: 4 }}
                        />
                    </LineChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
};
