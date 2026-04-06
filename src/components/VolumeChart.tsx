import { addDays, differenceInCalendarDays, eachDayOfInterval, format, parseISO } from 'date-fns';
import { Area, AreaChart, CartesianGrid, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatNumber } from "../lib/utils";
import type { ChartData, VolumeComparisons } from '../types';
import type { VolumeComparisonMode } from '../hooks/useDashboardData';
import { useFullscreenFrame } from './FullscreenFrame';
import { chartTheme } from '../lib/chartTheme';

interface VolumeChartProps {
    data?: ChartData[];
    loading: boolean;
    showComparisons?: boolean;
    comparisonMode?: VolumeComparisonMode;
    comparisons?: VolumeComparisons;
    currentRange?: {
        startDate: string;
        endDate: string;
    };
}

interface ComparisonChartRow {
    date: string;
    label: string;
    current: number;
    prevMonth: number | null;
    prevYear: number | null;
}

const toDateKey = (value: string) => value.slice(0, 10);

const buildCountMap = (series: ChartData[]) => {
    const counts = new Map<string, number>();
    series.forEach((item) => {
        counts.set(toDateKey(item.date), item.count);
    });
    return counts;
};

const buildComparisonRows = (
    current: ChartData[],
    comparisons: VolumeComparisons,
    currentRange: { startDate: string; endDate: string },
    mode: VolumeComparisonMode
): ComparisonChartRow[] => {
    const currentStart = parseISO(currentRange.startDate);
    const currentEnd = parseISO(currentRange.endDate);
    const prevMonthStart = comparisons.prevMonth ? parseISO(comparisons.prevMonth.startDate) : null;
    const prevMonthEnd = comparisons.prevMonth ? parseISO(comparisons.prevMonth.endDate) : null;
    const prevYearStart = parseISO(comparisons.prevYear.startDate);
    const prevYearEnd = parseISO(comparisons.prevYear.endDate);

    const days = eachDayOfInterval({ start: currentStart, end: currentEnd });
    const prevMonthSpan = prevMonthStart && prevMonthEnd ? differenceInCalendarDays(prevMonthEnd, prevMonthStart) : -1;
    const prevYearSpan = differenceInCalendarDays(prevYearEnd, prevYearStart);

    const currentMap = buildCountMap(current);
    const prevMonthMap = comparisons.prevMonth ? buildCountMap(comparisons.prevMonth.data) : new Map<string, number>();
    const prevYearMap = buildCountMap(comparisons.prevYear.data);

    return days.map((day, index) => {
        const currentKey = format(day, 'yyyy-MM-dd');
        const prevMonthDate = prevMonthStart ? addDays(prevMonthStart, index) : null;
        const prevYearDate = addDays(prevYearStart, index);
        const prevMonthKey = prevMonthDate ? format(prevMonthDate, 'yyyy-MM-dd') : '';
        const prevYearKey = format(prevYearDate, 'yyyy-MM-dd');

        return {
            date: currentKey,
            label: format(day, 'MMM d'),
            current: currentMap.get(currentKey) ?? 0,
            prevMonth: mode === 'month' && prevMonthStart && index <= prevMonthSpan ? (prevMonthMap.get(prevMonthKey) ?? 0) : null,
            prevYear: index <= prevYearSpan ? (prevYearMap.get(prevYearKey) ?? 0) : null
        };
    });
};

export const VolumeChart = ({ data, loading, showComparisons, comparisonMode = 'month', comparisons, currentRange }: VolumeChartProps) => {
    const isFullscreen = useFullscreenFrame();
    const chartHeightClass = isFullscreen ? 'h-[65vh] sm:h-[72vh]' : 'h-[250px] sm:h-[300px]';

    if (loading) {
        return <div className={`${chartHeightClass} w-full bg-brand-card/50 rounded-xl border border-subtle animate-pulse`} />;
    }

    if (!data || data.length === 0) {
        return (
            <div className={`${chartHeightClass} w-full bg-brand-card border border-subtle rounded-xl flex items-center justify-center text-fg-muted text-sm sm:text-base`}>
                No data available for this period
            </div>
        );
    }

    const hasComparisons = Boolean(showComparisons && comparisons && currentRange);
    const comparisonRows: ComparisonChartRow[] = hasComparisons && comparisons && currentRange
        ? buildComparisonRows(data, comparisons, currentRange, comparisonMode)
        : [];
    const hasPrevMonthData = Boolean(comparisons && comparisons.prevMonth && comparisons.prevMonth.data.length > 0);
    const hasPrevYearData = Boolean(comparisons && comparisons.prevYear.data.length > 0);

    return (
        <div className="bg-brand-card border border-subtle rounded-xl p-4 sm:p-6 shadow-card">
            <div className="mb-4 sm:mb-6">
                <h3 className="text-base sm:text-lg font-medium text-fg-primary">Consultation Volume</h3>
                {hasComparisons && !hasPrevYearData && (
                    <p className="text-xs text-fg-muted mt-1">
                        {comparisonMode === 'year'
                            ? 'No same-duration last-year data available for this selection.'
                            : 'No same-month last-year data available for this selection.'}
                    </p>
                )}
            </div>
            <div className={`${chartHeightClass} w-full`}>
                <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={hasComparisons ? comparisonRows : data}>
                        <defs>
                            <linearGradient id="colorCount" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor={chartTheme.primary} stopOpacity={0.3} />
                                <stop offset="95%" stopColor={chartTheme.primary} stopOpacity={0} />
                            </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} vertical={false} />
                        <XAxis
                            dataKey={hasComparisons ? 'label' : 'date'}
                            stroke={chartTheme.axis}
                            fontSize={11}
                            tickLine={false}
                            axisLine={false}
                            interval="preserveStartEnd"
                            minTickGap={24}
                            tickFormatter={(value) =>
                                hasComparisons
                                    ? value
                                    : new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
                            }
                        />
                        <YAxis
                            stroke={chartTheme.axis}
                            fontSize={12}
                            tickLine={false}
                            axisLine={false}
                            tickFormatter={(value) => `${value}`}
                        />
                        <Tooltip
                            contentStyle={{ backgroundColor: chartTheme.bg, borderColor: chartTheme.primary, color: chartTheme.tooltipFg }}
                            itemStyle={{ color: chartTheme.tooltipFg }}
                            formatter={(value: unknown, name: string | undefined) => {
                                const seriesName = name ?? 'Consults';
                                if (value === null || value === undefined) {
                                    return ['-', seriesName];
                                }
                                if (typeof value === 'number') {
                                    return [formatNumber(value), seriesName];
                                }
                                return [String(value), seriesName];
                            }}
                            labelFormatter={(label) =>
                                hasComparisons
                                    ? label
                                    : new Date(label).toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
                            }
                        />
                        {hasComparisons && (
                            <Legend
                                verticalAlign="top"
                                height={26}
                                wrapperStyle={{ color: 'var(--text-secondary)', fontSize: 11 }}
                            />
                        )}
                        <Area
                            type="monotone"
                            name={comparisonMode === 'year' ? 'Current Year' : 'Current Period'}
                            dataKey={hasComparisons ? 'current' : 'count'}
                            stroke={chartTheme.primary}
                            strokeWidth={2}
                            fillOpacity={1}
                            fill="url(#colorCount)"
                        />
                        {hasComparisons && comparisonMode === 'month' && hasPrevMonthData && (
                            <Line
                                type="monotone"
                                name="Previous Month Pace"
                                dataKey="prevMonth"
                                stroke={chartTheme.secondary}
                                strokeWidth={2}
                                dot={false}
                                connectNulls={false}
                                strokeDasharray="6 4"
                            />
                        )}
                        {hasComparisons && hasPrevYearData && (
                            <Line
                                type="monotone"
                                name={comparisonMode === 'year' ? 'Same Duration Last Year' : 'Same Month Last Year Pace'}
                                dataKey="prevYear"
                                stroke={chartTheme.tertiary}
                                strokeWidth={2}
                                dot={false}
                                connectNulls={false}
                                strokeDasharray="4 4"
                            />
                        )}
                    </AreaChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
};
