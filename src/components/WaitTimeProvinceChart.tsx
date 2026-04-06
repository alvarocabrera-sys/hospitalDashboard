import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { WaitTimeProvincePoint } from '../types';
import { formatQueryError } from '../lib/utils';
import { useFullscreenFrame } from './FullscreenFrame';
import { chartTheme } from '../lib/chartTheme';

interface WaitTimeProvinceChartProps {
    data?: WaitTimeProvincePoint[];
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

export const WaitTimeProvinceChart = ({ data, loading, error }: WaitTimeProvinceChartProps) => {
    const isFullscreen = useFullscreenFrame();
    const chartHeightClass = isFullscreen ? 'h-[65vh] sm:h-[72vh]' : 'h-[250px] sm:h-[300px]';

    if (loading) {
        return <div className={`${chartHeightClass} w-full bg-brand-card/50 rounded-xl border border-subtle animate-pulse`} />;
    }

    if (error) {
        return (
            <div className={`${chartHeightClass} w-full bg-brand-card border border-semantic-danger/30 rounded-xl flex items-center justify-center px-4 text-center`}>
                <p className="text-sm text-semantic-danger">
                    Could not load wait time by region: {formatQueryError(error)}
                </p>
            </div>
        );
    }

    if (!data || data.length === 0) {
        return (
            <div className={`${chartHeightClass} w-full bg-brand-card border border-subtle rounded-xl flex items-center justify-center text-fg-muted text-sm sm:text-base`}>
                No wait time by region data available
            </div>
        );
    }

    return (
        <div className="bg-brand-card border border-subtle rounded-xl p-4 sm:p-6 shadow-card">
            <div className="mb-4 sm:mb-6">
                <h3 className="text-base sm:text-lg font-medium text-fg-primary">Average Wait Time by Region</h3>
                <p className="text-xs text-fg-muted mt-1">Average claim delay by province/region using consult date/time when present.</p>
            </div>
            <div className={`${chartHeightClass} w-full`}>
                <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data} margin={{ top: 8, right: 10, left: 0, bottom: 10 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} vertical={false} />
                        <XAxis
                            dataKey="province"
                            stroke={chartTheme.axis}
                            fontSize={11}
                            tickLine={false}
                            axisLine={false}
                            interval={0}
                            angle={-15}
                            textAnchor="end"
                            height={52}
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
                            formatter={(value: unknown) => [`${Number(value).toFixed(1)} min`, 'Avg Wait']}
                        />
                        <Bar dataKey="avgWaitMinutes" fill={chartTheme.secondary} radius={[6, 6, 0, 0]} />
                    </BarChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
};
