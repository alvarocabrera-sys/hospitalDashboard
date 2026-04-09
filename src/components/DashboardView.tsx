import { useMemo, useState } from 'react';
import axios from 'axios';
import { Layout } from './Layout';
import { KPIGrid } from './KPIGrid';
import { VolumeChart } from './VolumeChart';
import { StoreList } from './StoreList';
import { StoreCheckInWidget } from './StoreCheckInWidget';
import { SpeciesChart } from './SpeciesChart';
import { WaitTimeDailyChart } from './WaitTimeDailyChart';
import { WaitTimeSpeciesChart } from './WaitTimeSpeciesChart';
import { WaitTimeProvinceChart } from './WaitTimeProvinceChart';
import { FullscreenFrame } from './FullscreenFrame';
import {
    useMetrics,
    useVolumeChart,
    useHospitals,
    useSpecies,
    useVolumeComparisons,
    useHospitalComparisons,
    useWaitTimeDaily,
    useWaitTimeBySpecies,
    useWaitTimeByProvince,
    usePremiumTierFilterOptions,
    useSpeciesFilterOptions,
    useHospitalDisplayByCode
} from '../hooks/useDashboardData';
import type { VolumeComparisonMode, HospitalComparisonMode } from '../hooks/useDashboardData';
import type { DashboardFilters } from '../types';
import { Filter, Calendar, MapPin, Layers, PawPrint } from 'lucide-react';
import { useIsFetching, useQueryClient } from '@tanstack/react-query';
import { startOfMonth, endOfMonth, subMonths, format, startOfYear } from 'date-fns';

const API_BASE = '/api';

type DurationOption = 'this_month' | 'last_month' | 'this_year' | 'all_time' | 'custom' | 'specific_month';

const PROVINCES = [
    'Ontario', 'British Columbia', 'Alberta', 'Quebec', 'Manitoba',
    'Nova Scotia', 'Saskatchewan', 'New Brunswick', 'Newfoundland and Labrador', 'Prince Edward Island'
];

const STATES = [
    'Alabama', 'Alaska', 'Arizona', 'Arkansas', 'California', 'Colorado', 'Connecticut', 'Delaware', 'Florida', 'Georgia',
    'Hawaii', 'Idaho', 'Illinois', 'Indiana', 'Iowa', 'Kansas', 'Kentucky', 'Louisiana', 'Maine', 'Maryland',
    'Massachusetts', 'Michigan', 'Minnesota', 'Mississippi', 'Missouri', 'Montana', 'Nebraska', 'Nevada', 'New Hampshire',
    'New Jersey', 'New Mexico', 'New York', 'North Carolina', 'North Dakota', 'Ohio', 'Oklahoma', 'Oregon', 'Pennsylvania',
    'Rhode Island', 'South Carolina', 'South Dakota', 'Tennessee', 'Texas', 'Utah', 'Vermont', 'Virginia', 'Washington',
    'West Virginia', 'Wisconsin', 'Wyoming'
];

const filterChipClass =
    'flex shrink-0 items-center gap-2 bg-brand-card p-1 rounded-lg border border-subtle shadow-sm min-w-0 transition-dashboard hover:bg-brand-card-hover/50';
const filterSelectClass =
    'bg-transparent border-none text-sm text-fg-primary focus:ring-0 cursor-pointer py-1.5 pl-2 pr-8 font-medium focus:text-brand-accent transition-dashboard min-w-[7.5rem] max-w-[14rem]';
const HOSPITAL_CHECK_IN_MAX_ITEMS = 10;

export const DashboardView = () => {
    const [duration, setDuration] = useState<DurationOption>('this_month');
    const [monthSelection, setMonthSelection] = useState<string>('');
    const [manualRefreshing, setManualRefreshing] = useState(false);

    const [filters, setFilters] = useState<DashboardFilters>(() => {
        const now = new Date();
        return {
            country: 'CA',
            province: undefined,
            startDate: format(startOfMonth(now), 'yyyy-MM-dd'),
            endDate: format(now, 'yyyy-MM-dd')
        };
    });

    const queryClient = useQueryClient();
    const metricsFetching = useIsFetching({ queryKey: ['metrics'] });
    const volumeFetching = useIsFetching({ queryKey: ['volume'] });
    const hospitalsFetching = useIsFetching({ queryKey: ['hospitals'] });
    const speciesFetching = useIsFetching({ queryKey: ['species'] });
    const volumeComparisonsFetching = useIsFetching({ queryKey: ['volume-comparisons'] });
    const hospitalComparisonsFetching = useIsFetching({ queryKey: ['hospital-comparisons'] });
    const waitTimeDailyFetching = useIsFetching({ queryKey: ['wait-time-daily'] });
    const waitTimeSpeciesFetching = useIsFetching({ queryKey: ['wait-time-species'] });
    const waitTimeProvinceFetching = useIsFetching({ queryKey: ['wait-time-province'] });
    const hospitalDisplayGlobalFetching = useIsFetching({ queryKey: ['hospitals-display'] });

    const { data: metrics, isLoading: dataLoading, dataUpdatedAt: metricsDataUpdatedAt } = useMetrics(filters);
    const { data: chartData, isLoading: chartLoading } = useVolumeChart(filters);
    const showVolumeComparisons = duration === 'this_month' || duration === 'last_month' || duration === 'specific_month';
    const volumeComparisonMode: VolumeComparisonMode = duration === 'this_year' ? 'year' : 'month';
    const { data: comparisonData, isLoading: comparisonLoading } = useVolumeComparisons(filters, showVolumeComparisons || duration === 'this_year', volumeComparisonMode);
    const { data: hospitals, isLoading: hospitalsLoading } = useHospitals(filters);
    const hospitalComparisonMode: HospitalComparisonMode | null = duration === 'all_time'
        ? null
        : duration === 'this_year'
            ? 'year'
            : duration === 'custom'
                ? 'period'
                : 'month';
    const showHospitalComparisons = Boolean(hospitalComparisonMode && filters.startDate && filters.endDate);
    const showHospitalPrevYear = Boolean(showHospitalComparisons && hospitalComparisonMode !== 'year');
    const hospitalPrevPeriodLabel = duration === 'this_year'
        ? 'Prior Year'
        : duration === 'custom'
            ? 'Prev Period'
            : 'Prev Month';
    const hospitalPrevYearLabel = duration === 'custom' ? 'Last Year' : 'Same Month LY';
    const { data: hospitalComparisons, isLoading: hospitalComparisonsLoading } = useHospitalComparisons(
        filters,
        showHospitalComparisons,
        hospitalComparisonMode ?? 'month'
    );
    const { data: speciesData, isLoading: speciesLoading } = useSpecies(filters);
    const { data: waitTimeDailyData, isLoading: waitTimeDailyLoading, error: waitTimeDailyError } = useWaitTimeDaily(filters);
    const { data: waitTimeSpeciesData, isLoading: waitTimeSpeciesLoading, error: waitTimeSpeciesError } = useWaitTimeBySpecies(filters);
    const { data: waitTimeProvinceData, isLoading: waitTimeProvinceLoading, error: waitTimeProvinceError } = useWaitTimeByProvince(filters);
    const { data: premiumTierOptions = [] } = usePremiumTierFilterOptions();
    const { data: speciesOptions = [] } = useSpeciesFilterOptions();

    const codesNeedingLabels = useMemo(() => {
        if (!hospitals || !hospitalComparisons?.prevPeriodByHospital) {
            return [];
        }

        const currentByHospital = new Map<string, number>();
        hospitals.forEach((hospital) => {
            currentByHospital.set(hospital.hospital_code, Number(hospital.volume) || 0);
        });

        const hospitalCodes = new Set<string>([
            ...Object.keys(hospitalComparisons.prevPeriodByHospital),
            ...currentByHospital.keys()
        ]);

        return [...hospitalCodes]
            .map((hospitalCode) => {
                const current = currentByHospital.get(hospitalCode) ?? 0;
                const prevPeriod = hospitalComparisons.prevPeriodByHospital[hospitalCode] ?? 0;
                const prevYear = hospitalComparisons.prevYearByHospital?.[hospitalCode];
                const dropVsPrev = prevPeriod - current;
                const dropVsYear = typeof prevYear === 'number' && current < prevYear ? prevYear - current : 0;

                return {
                    hospitalCode,
                    current,
                    prevPeriod,
                    dropVsPrev,
                    dropVsYear
                };
            })
            .filter((row) => row.prevPeriod > 0 && row.current < row.prevPeriod)
            .sort((a, b) => {
                if (b.dropVsPrev !== a.dropVsPrev) {
                    return b.dropVsPrev - a.dropVsPrev;
                }
                return b.dropVsYear - a.dropVsYear;
            })
            .slice(0, HOSPITAL_CHECK_IN_MAX_ITEMS)
            .map((row) => row.hospitalCode);
    }, [hospitals, hospitalComparisons]);

    const { data: hospitalDisplayByCode, isLoading: hospitalDisplayLoading } = useHospitalDisplayByCode(
        filters,
        codesNeedingLabels,
        showHospitalComparisons && codesNeedingLabels.length > 0
    );

    const handleDurationChange = (option: DurationOption) => {
        setDuration(option);
        const now = new Date();
        let start;
        let end;

        switch (option) {
            case 'this_month':
                start = startOfMonth(now);
                end = now;
                break;
            case 'last_month':
                start = startOfMonth(subMonths(now, 1));
                end = endOfMonth(subMonths(now, 1));
                break;
            case 'this_year':
                start = startOfYear(now);
                end = now;
                break;
            case 'all_time':
                setFilters((prev) => ({ ...prev, startDate: undefined, endDate: undefined }));
                return;
            case 'specific_month':
                return;
            case 'custom':
                return;
        }

        if (start && end) {
            setFilters((prev) => ({
                ...prev,
                startDate: format(start, 'yyyy-MM-dd'),
                endDate: format(end, 'yyyy-MM-dd')
            }));
        }
    };

    const handleMonthInput = (value: string) => {
        setMonthSelection(value);
        if (!value) return;
        const [year, month] = value.split('-').map(Number);
        const date = new Date(year, month - 1, 1);
        setFilters((prev) => ({
            ...prev,
            startDate: format(startOfMonth(date), 'yyyy-MM-dd'),
            endDate: format(endOfMonth(date), 'yyyy-MM-dd')
        }));
    };

    const handleRefresh = async () => {
        setManualRefreshing(true);
        try {
            try {
                await axios.post(`${API_BASE}/sync/bubble`, {}, { validateStatus: (s) => s < 500 });
            } catch {
                /* sync is optional (env off or network); still refresh dashboard reads */
            }
            await Promise.all([
                queryClient.refetchQueries({ queryKey: ['metrics'], type: 'active' }),
                queryClient.refetchQueries({ queryKey: ['volume'], type: 'active' }),
                queryClient.refetchQueries({ queryKey: ['hospitals'], type: 'active' }),
                queryClient.refetchQueries({ queryKey: ['species'], type: 'active' }),
                queryClient.refetchQueries({ queryKey: ['volume-comparisons'], type: 'active' }),
                queryClient.refetchQueries({ queryKey: ['hospital-comparisons'], type: 'active' }),
                queryClient.refetchQueries({ queryKey: ['hospitals-display'], type: 'active' }),
                queryClient.refetchQueries({ queryKey: ['wait-time-daily'], type: 'active' }),
                queryClient.refetchQueries({ queryKey: ['wait-time-species'], type: 'active' }),
                queryClient.refetchQueries({ queryKey: ['wait-time-province'], type: 'active' }),
                queryClient.refetchQueries({ queryKey: ['premium-tier-options'], type: 'active' }),
                queryClient.refetchQueries({ queryKey: ['species-options'], type: 'active' })
            ]);
        } finally {
            setManualRefreshing(false);
        }
    };

    const isRefreshing = manualRefreshing || (
        metricsFetching +
        volumeFetching +
        hospitalsFetching +
        speciesFetching +
        volumeComparisonsFetching +
        hospitalComparisonsFetching +
        hospitalDisplayGlobalFetching +
        waitTimeDailyFetching +
        waitTimeSpeciesFetching +
        waitTimeProvinceFetching
    ) > 0;
    const lastUpdatedDisplay = metricsDataUpdatedAt > 0
        ? new Date(metricsDataUpdatedAt).toISOString()
        : metrics?.lastUpdated;

    return (
        <Layout
            onRefresh={handleRefresh}
            isRefreshing={isRefreshing}
            lastUpdated={lastUpdatedDisplay}
            lastConsult={metrics?.lastConsult}
            petSmartConsultWarehouseTotal={metrics?.petSmartConsultWarehouseTotal}
        >
            <div className="space-y-6 sm:space-y-8">
                <div className="space-y-3 sm:space-y-4">
                    <h2 className="text-xl sm:text-2xl font-bold text-fg-primary px-1">Dashboard Overview</h2>

                    <div className="bg-brand-card p-4 sm:p-6 rounded-2xl border border-subtle shadow-card backdrop-blur-sm">
                        <div className="flex flex-nowrap items-center gap-2 sm:gap-3 overflow-x-auto pb-1 -mx-1 px-1">
                            <div className={filterChipClass}>
                                <Calendar className="h-4 w-4 text-brand-accent ml-2 shrink-0" />
                                <select
                                    aria-label="Date range preset"
                                    className={`${filterSelectClass} min-w-[10rem]`}
                                    value={duration}
                                    onChange={(event) => handleDurationChange(event.target.value as DurationOption)}
                                >
                                    <option value="this_month" className="bg-brand-card">Current Month</option>
                                    <option value="last_month" className="bg-brand-card">Last Month</option>
                                    <option value="this_year" className="bg-brand-card">This Year</option>
                                    <option value="all_time" className="bg-brand-card">All Time</option>
                                    <option value="specific_month" className="bg-brand-card">Pick Month</option>
                                    <option value="custom" className="bg-brand-card">Custom Range</option>
                                </select>
                            </div>

                            {duration === 'specific_month' && (
                                <input
                                    type="month"
                                    aria-label="Select month"
                                    className="shrink-0 bg-brand-card border border-subtle rounded-lg text-sm text-fg-primary px-3 py-2 focus:ring-2 focus:ring-brand outline-none min-w-[10rem] transition-dashboard"
                                    value={monthSelection}
                                    onChange={(event) => handleMonthInput(event.target.value)}
                                />
                            )}

                            {duration === 'custom' && (
                                <>
                                    <input
                                        type="date"
                                        aria-label="Custom range start date"
                                        className="shrink-0 bg-brand-card border border-subtle rounded-lg text-sm text-fg-primary px-3 py-2 focus:ring-2 focus:ring-brand outline-none min-w-[9rem] transition-dashboard"
                                        value={filters.startDate || ''}
                                        onChange={(event) => setFilters((prev) => ({ ...prev, startDate: event.target.value }))}
                                    />
                                    <span className="text-fg-muted shrink-0">–</span>
                                    <input
                                        type="date"
                                        aria-label="Custom range end date"
                                        className="shrink-0 bg-brand-card border border-subtle rounded-lg text-sm text-fg-primary px-3 py-2 focus:ring-2 focus:ring-brand outline-none min-w-[9rem] transition-dashboard"
                                        value={filters.endDate || ''}
                                        onChange={(event) => setFilters((prev) => ({ ...prev, endDate: event.target.value }))}
                                    />
                                </>
                            )}

                            <div className={filterChipClass}>
                                <Filter className="h-4 w-4 text-brand-accent ml-2 shrink-0" />
                                <select
                                    aria-label="Country"
                                    className={filterSelectClass}
                                    value={filters.country || ''}
                                    onChange={(event) => setFilters((prev) => ({ ...prev, country: event.target.value || undefined }))}
                                >
                                    <option value="" className="bg-brand-card">All Countries</option>
                                    <option value="CA" className="bg-brand-card">Canada</option>
                                    <option value="US" className="bg-brand-card">USA</option>
                                </select>
                            </div>

                            <div className={filterChipClass}>
                                <MapPin className="h-4 w-4 text-brand-accent ml-2 shrink-0" />
                                <select
                                    aria-label="Province or region"
                                    className={`${filterSelectClass} min-w-[10rem]`}
                                    value={filters.province || ''}
                                    onChange={(event) => setFilters((prev) => ({ ...prev, province: event.target.value || undefined }))}
                                >
                                    <option value="" className="bg-brand-card">All Regions</option>
                                    {filters.country === 'US'
                                        ? STATES.map((state) => <option key={state} value={state} className="bg-brand-card">{state}</option>)
                                        : PROVINCES.map((province) => <option key={province} value={province} className="bg-brand-card">{province}</option>)}
                                </select>
                            </div>

                            <div className={filterChipClass}>
                                <Layers className="h-4 w-4 text-brand-accent ml-2 shrink-0" />
                                <select
                                    aria-label="Premium tier"
                                    className={`${filterSelectClass} min-w-[11rem]`}
                                    value={filters.premium_tier || ''}
                                    onChange={(event) => setFilters((prev) => ({ ...prev, premium_tier: event.target.value || undefined }))}
                                >
                                    <option value="" className="bg-brand-card">All premium tiers</option>
                                    {premiumTierOptions.map((tier) => (
                                        <option key={tier} value={tier} className="bg-brand-card">{tier}</option>
                                    ))}
                                </select>
                            </div>

                            <div className={filterChipClass}>
                                <PawPrint className="h-4 w-4 text-brand-accent ml-2 shrink-0" />
                                <select
                                    aria-label="Species"
                                    className={`${filterSelectClass} min-w-[9rem]`}
                                    value={filters.species || ''}
                                    onChange={(event) => setFilters((prev) => ({ ...prev, species: event.target.value || undefined }))}
                                >
                                    <option value="" className="bg-brand-card">All species</option>
                                    {speciesOptions.map((sp) => (
                                        <option key={sp} value={sp} className="bg-brand-card">{sp}</option>
                                    ))}
                                </select>
                            </div>
                        </div>
                    </div>
                </div>

                <KPIGrid metrics={metrics} loading={dataLoading} />

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 sm:gap-8">
                    <div className="lg:col-span-2">
                        <FullscreenFrame>
                            <VolumeChart
                                data={chartData}
                                loading={chartLoading || ((showVolumeComparisons || duration === 'this_year') && comparisonLoading)}
                                showComparisons={showVolumeComparisons || duration === 'this_year'}
                                comparisonMode={volumeComparisonMode}
                                comparisons={(showVolumeComparisons || duration === 'this_year') ? comparisonData : undefined}
                                currentRange={
                                    (showVolumeComparisons || duration === 'this_year') && filters.startDate && filters.endDate
                                        ? { startDate: filters.startDate, endDate: filters.endDate }
                                        : undefined
                                }
                            />
                        </FullscreenFrame>
                    </div>
                    <div className="lg:col-span-1">
                        <FullscreenFrame>
                            <SpeciesChart data={speciesData} loading={speciesLoading} />
                        </FullscreenFrame>
                    </div>
                </div>

                <div className="grid grid-cols-1 xl:grid-cols-3 gap-5 sm:gap-8">
                    <FullscreenFrame>
                        <WaitTimeDailyChart data={waitTimeDailyData} loading={waitTimeDailyLoading} error={waitTimeDailyError} />
                    </FullscreenFrame>
                    <FullscreenFrame>
                        <WaitTimeSpeciesChart data={waitTimeSpeciesData} loading={waitTimeSpeciesLoading} error={waitTimeSpeciesError} />
                    </FullscreenFrame>
                    <FullscreenFrame>
                        <WaitTimeProvinceChart data={waitTimeProvinceData} loading={waitTimeProvinceLoading} error={waitTimeProvinceError} />
                    </FullscreenFrame>
                </div>

                <div className="w-full space-y-6">
                    <FullscreenFrame>
                        <StoreCheckInWidget
                            hospitals={hospitals}
                            comparisons={showHospitalComparisons ? hospitalComparisons : undefined}
                            displayByCode={hospitalDisplayByCode}
                            loading={
                                hospitalsLoading
                                || (showHospitalComparisons && hospitalComparisonsLoading)
                                || (showHospitalComparisons && codesNeedingLabels.length > 0 && hospitalDisplayLoading)
                            }
                            comparisonLabel={hospitalPrevPeriodLabel}
                            yearLabel={showHospitalPrevYear ? hospitalPrevYearLabel : undefined}
                            maxItems={HOSPITAL_CHECK_IN_MAX_ITEMS}
                        />
                    </FullscreenFrame>
                    <FullscreenFrame>
                        <StoreList
                            hospitals={hospitals}
                            loading={hospitalsLoading || (showHospitalComparisons && hospitalComparisonsLoading)}
                            comparisons={showHospitalComparisons ? hospitalComparisons : undefined}
                            showComparisonColumns={showHospitalComparisons}
                            showPrevYearColumn={showHospitalPrevYear}
                            prevPeriodLabel={hospitalPrevPeriodLabel}
                            prevYearLabel={hospitalPrevYearLabel}
                        />
                    </FullscreenFrame>
                </div>
            </div>
        </Layout>
    );
};
