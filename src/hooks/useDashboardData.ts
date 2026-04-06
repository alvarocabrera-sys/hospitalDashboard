import { useQuery } from '@tanstack/react-query';
import axios from 'axios';
import {
    addDays,
    differenceInCalendarDays,
    endOfMonth,
    endOfYear,
    format,
    parseISO,
    startOfMonth,
    startOfYear,
    subDays,
    subMonths,
    subYears
} from 'date-fns';
import type {
    DashboardMetrics,
    Consultation,
    DashboardFilters,
    VolumeComparisons,
    ChartData,
    HospitalComparisonData,
    HospitalData,
    HospitalDisplayByCode,
    HospitalDisplayRow,
    WaitTimeDailyPoint,
    WaitTimeSpeciesPoint,
    WaitTimeProvincePoint
} from '../types';

const API_BASE = '/api';
export type VolumeComparisonMode = 'month' | 'year';
export type HospitalComparisonMode = 'month' | 'year' | 'period';

const mapVolumeRows = (rows: { date: string; count: string }[]): ChartData[] => {
    return rows.map((d) => ({ ...d, count: parseInt(d.count, 10) }));
};

const parseWaitMinutes = (value: string | number | null | undefined) => {
    if (typeof value === 'number') {
        return Number.isFinite(value) ? value : 0;
    }
    const parsed = parseFloat(value ?? '0');
    return Number.isFinite(parsed) ? parsed : 0;
};

/** Stable query params: omit undefined/null/empty so the API receives the same shape as other dashboard calls. */
const serializeDashboardFilters = (filters: DashboardFilters): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(filters)) {
        if (value !== undefined && value !== null && value !== '') {
            out[key] = String(value);
        }
    }
    return out;
};

const normalizeWaitTimeDailyDate = (row: { date?: unknown; created_day?: unknown }) => {
    const raw = row.date ?? row.created_day;
    if (raw == null) {
        return '';
    }
    if (typeof raw === 'string') {
        return raw.slice(0, 10);
    }
    if (raw instanceof Date) {
        return format(raw, 'yyyy-MM-dd');
    }
    return String(raw);
};

const buildComparableRanges = (filters: DashboardFilters, mode: VolumeComparisonMode) => {
    if (!filters.startDate || !filters.endDate) {
        return null;
    }

    const currentStart = parseISO(filters.startDate);
    const currentEnd = parseISO(filters.endDate);
    const elapsedDays = Math.max(0, differenceInCalendarDays(currentEnd, currentStart));

    if (mode === 'year') {
        const prevYearStart = startOfYear(subYears(currentStart, 1));
        const prevYearHardEnd = endOfYear(prevYearStart);
        const prevYearTargetEnd = addDays(prevYearStart, elapsedDays);
        const prevYearEnd = prevYearTargetEnd > prevYearHardEnd ? prevYearHardEnd : prevYearTargetEnd;

        return {
            prevYear: {
                startDate: format(prevYearStart, 'yyyy-MM-dd'),
                endDate: format(prevYearEnd, 'yyyy-MM-dd')
            }
        };
    }

    const prevMonthStart = startOfMonth(subMonths(currentStart, 1));
    const prevMonthHardEnd = endOfMonth(prevMonthStart);
    const prevMonthTargetEnd = addDays(prevMonthStart, elapsedDays);
    const prevMonthEnd = prevMonthTargetEnd > prevMonthHardEnd ? prevMonthHardEnd : prevMonthTargetEnd;

    const prevYearStart = startOfMonth(subYears(currentStart, 1));
    const prevYearHardEnd = endOfMonth(prevYearStart);
    const prevYearTargetEnd = addDays(prevYearStart, elapsedDays);
    const prevYearEnd = prevYearTargetEnd > prevYearHardEnd ? prevYearHardEnd : prevYearTargetEnd;

    return {
        prevMonth: {
            startDate: format(prevMonthStart, 'yyyy-MM-dd'),
            endDate: format(prevMonthEnd, 'yyyy-MM-dd')
        },
        prevYear: {
            startDate: format(prevYearStart, 'yyyy-MM-dd'),
            endDate: format(prevYearEnd, 'yyyy-MM-dd')
        }
    };
};

const buildHospitalComparisonRanges = (filters: DashboardFilters, mode: HospitalComparisonMode) => {
    if (!filters.startDate || !filters.endDate) {
        return null;
    }

    const currentStart = parseISO(filters.startDate);
    const currentEnd = parseISO(filters.endDate);
    const elapsedDays = Math.max(0, differenceInCalendarDays(currentEnd, currentStart));

    if (mode === 'year') {
        const prevPeriodStart = startOfYear(subYears(currentStart, 1));
        const prevPeriodHardEnd = endOfYear(prevPeriodStart);
        const prevPeriodTargetEnd = addDays(prevPeriodStart, elapsedDays);
        const prevPeriodEnd = prevPeriodTargetEnd > prevPeriodHardEnd ? prevPeriodHardEnd : prevPeriodTargetEnd;

        return {
            prevPeriod: {
                startDate: format(prevPeriodStart, 'yyyy-MM-dd'),
                endDate: format(prevPeriodEnd, 'yyyy-MM-dd')
            }
        };
    }

    if (mode === 'month') {
        const prevPeriodStart = startOfMonth(subMonths(currentStart, 1));
        const prevPeriodHardEnd = endOfMonth(prevPeriodStart);
        const prevPeriodTargetEnd = addDays(prevPeriodStart, elapsedDays);
        const prevPeriodEnd = prevPeriodTargetEnd > prevPeriodHardEnd ? prevPeriodHardEnd : prevPeriodTargetEnd;

        const prevYearStart = startOfMonth(subYears(currentStart, 1));
        const prevYearHardEnd = endOfMonth(prevYearStart);
        const prevYearTargetEnd = addDays(prevYearStart, elapsedDays);
        const prevYearEnd = prevYearTargetEnd > prevYearHardEnd ? prevYearHardEnd : prevYearTargetEnd;

        return {
            prevPeriod: {
                startDate: format(prevPeriodStart, 'yyyy-MM-dd'),
                endDate: format(prevPeriodEnd, 'yyyy-MM-dd')
            },
            prevYear: {
                startDate: format(prevYearStart, 'yyyy-MM-dd'),
                endDate: format(prevYearEnd, 'yyyy-MM-dd')
            }
        };
    }

    const prevPeriodEnd = subDays(currentStart, 1);
    const prevPeriodStart = subDays(prevPeriodEnd, elapsedDays);
    const prevYearStart = subYears(currentStart, 1);
    const prevYearEnd = subYears(currentEnd, 1);

    return {
        prevPeriod: {
            startDate: format(prevPeriodStart, 'yyyy-MM-dd'),
            endDate: format(prevPeriodEnd, 'yyyy-MM-dd')
        },
        prevYear: {
            startDate: format(prevYearStart, 'yyyy-MM-dd'),
            endDate: format(prevYearEnd, 'yyyy-MM-dd')
        }
    };
};

export const useMetrics = (filters: DashboardFilters) => {
    return useQuery({
        queryKey: ['metrics', filters],
        queryFn: async () => {
            const { data } = await axios.get<DashboardMetrics>(`${API_BASE}/metrics`, { params: filters });
            return data;
        }
    });
};

export const useVolumeChart = (filters: DashboardFilters) => {
    return useQuery({
        queryKey: ['volume', filters],
        queryFn: async () => {
            const { data } = await axios.get<{ date: string; count: string }[]>(`${API_BASE}/charts/volume`, { params: filters });
            return mapVolumeRows(data);
        }
    });
};

export const useVolumeComparisons = (filters: DashboardFilters, enabled: boolean, mode: VolumeComparisonMode = 'month') => {
    return useQuery({
        queryKey: ['volume-comparisons', mode, filters],
        enabled: enabled && Boolean(filters.startDate && filters.endDate),
        queryFn: async (): Promise<VolumeComparisons> => {
            const ranges = buildComparableRanges(filters, mode);
            if (!ranges) {
                throw new Error('Current date range is required for comparisons');
            }

            const baseFilters: DashboardFilters = {
                ...filters,
                month: undefined
            };

            if (mode === 'year') {
                const prevYearResponse = await axios.get<{ date: string; count: string }[]>(`${API_BASE}/charts/volume`, {
                    params: {
                        ...baseFilters,
                        startDate: ranges.prevYear.startDate,
                        endDate: ranges.prevYear.endDate
                    }
                });

                return {
                    prevYear: {
                        startDate: ranges.prevYear.startDate,
                        endDate: ranges.prevYear.endDate,
                        data: mapVolumeRows(prevYearResponse.data)
                    }
                };
            }

            const prevMonthRange = ranges.prevMonth;
            if (!prevMonthRange) {
                throw new Error('Previous month comparison range is missing');
            }

            const [prevMonthResponse, prevYearResponse] = await Promise.all([
                axios.get<{ date: string; count: string }[]>(`${API_BASE}/charts/volume`, {
                    params: {
                        ...baseFilters,
                        startDate: prevMonthRange.startDate,
                        endDate: prevMonthRange.endDate
                    }
                }),
                axios.get<{ date: string; count: string }[]>(`${API_BASE}/charts/volume`, {
                    params: {
                        ...baseFilters,
                        startDate: ranges.prevYear.startDate,
                        endDate: ranges.prevYear.endDate
                    }
                })
            ]);

            return {
                prevMonth: {
                    startDate: prevMonthRange.startDate,
                    endDate: prevMonthRange.endDate,
                    data: mapVolumeRows(prevMonthResponse.data)
                },
                prevYear: {
                    startDate: ranges.prevYear.startDate,
                    endDate: ranges.prevYear.endDate,
                    data: mapVolumeRows(prevYearResponse.data)
                }
            };
        }
    });
};

export const useHospitals = (filters: DashboardFilters) => {
    return useQuery({
        queryKey: ['hospitals', filters],
        queryFn: async () => {
            const { data } = await axios.get<
                {
                    hospital_code: string;
                    hospital_internal_name?: string | null;
                    province: string;
                    premium_tier?: string | null;
                    volume: string;
                    transfers: string;
                }[]
            >(`${API_BASE}/hospitals`, { params: filters });
            return data.map((d): HospitalData => ({
                hospital_code: d.hospital_code,
                hospital_internal_name: d.hospital_internal_name ?? null,
                province: d.province,
                premium_tier: d.premium_tier ?? null,
                volume: parseInt(d.volume, 10),
                transfers: parseInt(d.transfers || '0', 10)
            }));
        }
    });
};

export const usePremiumTierFilterOptions = () => {
    return useQuery({
        queryKey: ['premium-tier-options'],
        queryFn: async () => {
            const { data } = await axios.get<string[]>(`${API_BASE}/filters/premium-tiers`);
            return data;
        },
        staleTime: 5 * 60 * 1000
    });
};

export const useSpeciesFilterOptions = () => {
    return useQuery({
        queryKey: ['species-options'],
        queryFn: async () => {
            const { data } = await axios.get<string[]>(`${API_BASE}/filters/species`);
            return data;
        },
        staleTime: 5 * 60 * 1000
    });
};

export const useHospitalComparisons = (filters: DashboardFilters, enabled: boolean, mode: HospitalComparisonMode) => {
    return useQuery({
        queryKey: ['hospital-comparisons', mode, filters],
        enabled: enabled && Boolean(filters.startDate && filters.endDate),
        queryFn: async (): Promise<HospitalComparisonData> => {
            const ranges = buildHospitalComparisonRanges(filters, mode);
            if (!ranges) {
                throw new Error('Current date range is required for hospital comparisons');
            }

            const baseFilters: DashboardFilters = {
                ...filters,
                month: undefined
            };

            const prevPeriodResponse = await axios.get<{ hospital_code: string; volume: string }[]>(`${API_BASE}/hospitals`, {
                params: {
                    ...baseFilters,
                    startDate: ranges.prevPeriod.startDate,
                    endDate: ranges.prevPeriod.endDate
                }
            });

            const prevPeriodByHospital = prevPeriodResponse.data.reduce<Record<string, number>>((acc, row) => {
                acc[row.hospital_code] = parseInt(row.volume, 10) || 0;
                return acc;
            }, {});

            if (!ranges.prevYear) {
                return { prevPeriodByHospital };
            }

            const prevYearResponse = await axios.get<{ hospital_code: string; volume: string }[]>(`${API_BASE}/hospitals`, {
                params: {
                    ...baseFilters,
                    startDate: ranges.prevYear.startDate,
                    endDate: ranges.prevYear.endDate
                }
            });

            const prevYearByHospital = prevYearResponse.data.reduce<Record<string, number>>((acc, row) => {
                acc[row.hospital_code] = parseInt(row.volume, 10) || 0;
                return acc;
            }, {});

            return {
                prevPeriodByHospital,
                prevYearByHospital
            };
        }
    });
};

export const useHospitalDisplayByCode = (filters: DashboardFilters, codes: string[], enabled: boolean) => {
    const uniqueCodes = [...new Set(codes.filter(Boolean))].slice(0, 150);
    const codesKey = uniqueCodes.slice().sort().join('\u0001');
    return useQuery({
        queryKey: ['hospitals-display', serializeDashboardFilters(filters), codesKey],
        enabled: enabled && uniqueCodes.length > 0,
        queryFn: async (): Promise<HospitalDisplayByCode> => {
            const params: Record<string, string> = {
                ...serializeDashboardFilters(filters),
                codes: uniqueCodes.join(',')
            };
            const { data } = await axios.get<HospitalDisplayRow[]>(`${API_BASE}/hospitals/display`, { params });
            const map: HospitalDisplayByCode = {};
            for (const row of data) {
                map[row.hospital_code] = { hospital_internal_name: row.hospital_internal_name };
            }
            return map;
        }
    });
};

export const useSpecies = (filters: DashboardFilters) => {
    return useQuery({
        queryKey: ['species', filters],
        queryFn: async () => {
            const { data } = await axios.get<{ species: string; count: string }[]>(`${API_BASE}/species`, { params: filters });
            return data.map(d => ({ ...d, count: parseInt(d.count) }));
        }
    });
};

export const useWaitTimeDaily = (filters: DashboardFilters) => {
    return useQuery({
        queryKey: ['wait-time-daily', filters],
        queryFn: async () => {
            const { data } = await axios.get<{ date?: string; created_day?: string; avg_wait_minutes: string | number | null }[]>(
                `${API_BASE}/charts/wait-time/daily`,
                { params: serializeDashboardFilters(filters) }
            );

            return data
                .map((row): WaitTimeDailyPoint => ({
                    date: normalizeWaitTimeDailyDate(row),
                    avgWaitMinutes: parseWaitMinutes(row.avg_wait_minutes)
                }))
                .filter((row) => row.date.length > 0);
        },
        retry: 1
    });
};

export const useWaitTimeBySpecies = (filters: DashboardFilters) => {
    return useQuery({
        queryKey: ['wait-time-species', filters],
        queryFn: async () => {
            const { data } = await axios.get<{ species: string; avg_wait_minutes: string | number | null }[]>(
                `${API_BASE}/charts/wait-time/species`,
                { params: serializeDashboardFilters(filters) }
            );

            return data.map((row): WaitTimeSpeciesPoint => ({
                species: row.species,
                avgWaitMinutes: parseWaitMinutes(row.avg_wait_minutes)
            }));
        },
        retry: 1
    });
};

export const useWaitTimeByProvince = (filters: DashboardFilters) => {
    return useQuery({
        queryKey: ['wait-time-province', filters],
        queryFn: async () => {
            const { data } = await axios.get<{ province: string; avg_wait_minutes: string | number | null }[]>(
                `${API_BASE}/charts/wait-time/province`,
                { params: serializeDashboardFilters(filters) }
            );

            return data.map((row): WaitTimeProvincePoint => ({
                province: row.province,
                avgWaitMinutes: parseWaitMinutes(row.avg_wait_minutes)
            }));
        },
        retry: 1
    });
};

export const useConsultations = (filters: DashboardFilters) => {
    return useQuery({
        queryKey: ['consultations', filters],
        queryFn: async () => {
            const { data } = await axios.get<Consultation[]>(`${API_BASE}/consultations`, { params: filters });
            return data;
        }
    });
};
