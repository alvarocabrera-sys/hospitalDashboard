import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import type { SpeciesData } from '../types';
import { useFullscreenFrame } from './FullscreenFrame';
import { chartSpeciesColors, chartTheme } from '../lib/chartTheme';

interface SpeciesChartProps {
    data?: SpeciesData[];
    loading: boolean;
}

export const SpeciesChart = ({ data, loading }: SpeciesChartProps) => {
    const isFullscreen = useFullscreenFrame();
    const chartHeightClass = isFullscreen ? 'h-[65vh] sm:h-[72vh]' : 'h-[320px] sm:h-[400px]';

    if (loading) {
        return (
            <div className={`bg-brand-card/50 border border-subtle rounded-xl p-4 sm:p-6 ${chartHeightClass} flex items-center justify-center animate-pulse`}>
                <div className="h-40 w-40 sm:h-48 sm:w-48 rounded-full bg-brand-card-hover" />
            </div>
        );
    }

    if (!data || data.length === 0) {
        return (
            <div className={`bg-brand-card border border-subtle rounded-xl p-4 sm:p-6 ${chartHeightClass} flex items-center justify-center text-fg-muted text-sm sm:text-base`}>
                No species data available
            </div>
        );
    }

    return (
        <div className={`bg-brand-card border border-subtle rounded-xl p-4 sm:p-6 ${chartHeightClass} flex flex-col shadow-card`}>
            <h3 className="text-base sm:text-lg font-semibold text-fg-primary mb-3 sm:mb-6">Species Breakdown</h3>
            <div className="flex-1 w-full min-h-0">
                <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                        <Pie
                            data={data as unknown as Array<Record<string, string | number>>}
                            cx="50%"
                            cy="50%"
                            innerRadius="45%"
                            outerRadius="72%"
                            paddingAngle={5}
                            dataKey="count"
                            nameKey="species"
                            stroke="none"
                        >
                            {data.map((_, index) => (
                                <Cell key={`cell-${index}`} fill={chartSpeciesColors[index % chartSpeciesColors.length]} />
                            ))}
                        </Pie>
                        <Tooltip
                            contentStyle={{
                                backgroundColor: chartTheme.bg,
                                border: `1px solid ${chartTheme.primary}`,
                                borderRadius: '0.5rem',
                                color: chartTheme.tooltipFg
                            }}
                            itemStyle={{ color: chartTheme.tooltipFg }}
                            formatter={(value: unknown) => [`${String(value ?? 0)} Consults`, 'Volume']}
                        />
                        <Legend
                            verticalAlign="bottom"
                            height={44}
                            wrapperStyle={{ fontSize: 11, lineHeight: 1.3 }}
                            formatter={(value) => <span className="text-fg-secondary text-xs sm:text-sm font-medium ml-1">{value}</span>}
                        />
                    </PieChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
};
