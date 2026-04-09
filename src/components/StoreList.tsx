import { useState } from 'react';
import type { HospitalData, HospitalComparisonData } from '../types';
import { formatNumber, hospitalDisplayPrimary, hospitalShowCodeSubtitle } from '../lib/utils';
import { ChevronDown, ChevronUp, Search, Hospital as HospitalIcon } from 'lucide-react';
import { useFullscreenFrame } from './FullscreenFrame';

interface StoreListProps {
    hospitals?: HospitalData[];
    loading: boolean;
    comparisons?: HospitalComparisonData;
    showComparisonColumns?: boolean;
    showPrevYearColumn?: boolean;
    prevPeriodLabel?: string;
    prevYearLabel?: string;
}

type SortField = 'volume' | 'hospital_code';
type SortDirection = 'asc' | 'desc';

const getComparisonBadgeClasses = (currentVolume: number, comparisonVolume: number) => {
    if (currentVolume > comparisonVolume) {
        return 'bg-semantic-success/10 text-semantic-success';
    }
    if (currentVolume < comparisonVolume) {
        return 'bg-semantic-danger/10 text-semantic-danger';
    }
    return 'bg-semantic-info/10 text-semantic-info';
};

export const StoreList = ({
    hospitals,
    loading,
    comparisons,
    showComparisonColumns = false,
    showPrevYearColumn = false,
    prevPeriodLabel = 'Prev Period',
    prevYearLabel = 'Last Year'
}: StoreListProps) => {
    const isFullscreen = useFullscreenFrame();
    const loadingHeightClass = isFullscreen ? 'h-[78vh]' : 'h-[380px] sm:h-[400px]';
    const tableHeightClass = isFullscreen ? 'h-[82vh]' : 'h-[440px] sm:h-[500px]';

    const [sortField, setSortField] = useState<SortField>('volume');
    const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
    const [search, setSearch] = useState('');

    if (loading) {
        return <div className={`${loadingHeightClass} w-full bg-brand-card/50 rounded-xl border border-subtle animate-pulse`} />;
    }

    if (!hospitals) return null;
    const colSpan = 5 + (showComparisonColumns ? 1 : 0) + (showPrevYearColumn ? 1 : 0);

    const handleSort = (field: SortField) => {
        if (sortField === field) {
            setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
        } else {
            setSortField(field);
            setSortDirection('desc');
        }
    };

    const q = search.toLowerCase();
    const sortedHospitals = [...hospitals]
        .filter((s) => {
            if (!q) return true;
            if (s.hospital_code.toLowerCase().includes(q)) return true;
            const internal = s.hospital_internal_name?.toLowerCase() ?? '';
            return internal.includes(q);
        })
        .sort((a, b) => {
            const multi = sortDirection === 'asc' ? 1 : -1;
            if (sortField === 'volume') {
                return (Number(a.volume) - Number(b.volume)) * multi;
            }
            return a.hospital_code.localeCompare(b.hospital_code) * multi;
        });
    const visibleHospitals = q ? sortedHospitals : sortedHospitals.slice(0, 10);
    const subtitle = q
        ? `Showing ${visibleHospitals.length} matching hospital${visibleHospitals.length === 1 ? '' : 's'}`
        : sortField === 'volume' && sortDirection === 'desc'
            ? 'Top 10 by volume'
            : `Showing ${visibleHospitals.length} hospitals`;
    const maxVol = Math.max(0, ...visibleHospitals.map(s => Number(s.volume)));

    return (
        <div className={`bg-brand-card border border-subtle rounded-xl overflow-hidden flex flex-col ${tableHeightClass} shadow-card`}>
            <div className="p-4 sm:p-6 border-b border-subtle flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4">
                <div>
                    <h3 className="text-base sm:text-lg font-medium text-fg-primary">Hospital Performance</h3>
                    <p className="text-xs text-fg-muted mt-1">{subtitle}</p>
                </div>
                <div className="relative w-full sm:w-auto">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-fg-muted" />
                    <input
                        type="text"
                        placeholder="Search hospitals..."
                        className="pl-9 pr-4 py-2 bg-brand-card-hover border border-subtle rounded-lg text-sm text-fg-secondary focus:outline-none focus:ring-2 focus:ring-brand placeholder:text-fg-muted w-full sm:w-64 transition-dashboard"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                    />
                </div>
            </div>

            <div className="flex-1 overflow-auto">
                <table className={`w-full ${showComparisonColumns ? 'min-w-[1040px]' : 'min-w-[760px]'} text-left text-sm`}>
                    <thead className="bg-brand-card-hover text-fg-muted sticky top-0 z-10 backdrop-blur-md">
                        <tr>
                            <th
                                className="px-4 sm:px-6 py-3 font-medium cursor-pointer hover:text-brand-accent transition-colors"
                                onClick={() => handleSort('hospital_code')}
                            >
                                <div className="flex items-center gap-2">
                                    Hospital
                                    {sortField === 'hospital_code' && (sortDirection === 'asc' ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />)}
                                </div>
                            </th>
                            <th className="px-4 sm:px-6 py-3 font-medium">Location</th>
                            <th className="px-4 sm:px-6 py-3 font-medium">Premium tier</th>
                            <th className="px-4 sm:px-6 py-3 font-medium text-center">Transfers</th>
                            <th
                                className="px-4 sm:px-6 py-3 font-medium cursor-pointer hover:text-brand-accent transition-colors text-right"
                                onClick={() => handleSort('volume')}
                            >
                                <div className="flex items-center justify-end gap-2">
                                    Volume
                                    {sortField === 'volume' && (sortDirection === 'asc' ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />)}
                                </div>
                            </th>
                            {showComparisonColumns && (
                                <th className="px-4 sm:px-6 py-3 font-medium text-right whitespace-nowrap">{prevPeriodLabel}</th>
                            )}
                            {showPrevYearColumn && (
                                <th className="px-4 sm:px-6 py-3 font-medium text-right whitespace-nowrap">{prevYearLabel}</th>
                            )}
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-subtle">
                        {visibleHospitals.map((hospital) => {
                            const currentVolume = Number(hospital.volume);
                            const percentage = maxVol > 0 ? (currentVolume / maxVol) * 100 : 0;
                            const prevPeriodVolume = comparisons?.prevPeriodByHospital?.[hospital.hospital_code];
                            const prevYearVolume = comparisons?.prevYearByHospital?.[hospital.hospital_code];

                            return (
                                <tr key={hospital.hospital_code} className="hover:bg-brand-card-hover/35 transition-dashboard group">
                                    <td className="px-4 sm:px-6 py-3.5 sm:py-4 font-medium text-fg-secondary">
                                        <div className="flex items-center gap-2.5 sm:gap-3">
                                            <div className="p-1.5 sm:p-2 bg-brand-card-hover rounded-lg text-fg-muted group-hover:text-brand-accent group-hover:bg-brand-accent/10 transition-dashboard shrink-0">
                                                <HospitalIcon className="h-4 w-4" />
                                            </div>
                                            <div className="min-w-0">
                                                <div className="text-fg-primary truncate" title={hospitalDisplayPrimary(hospital)}>
                                                    {hospitalDisplayPrimary(hospital)}
                                                </div>
                                                {hospitalShowCodeSubtitle(hospital) && (
                                                    <div className="text-[11px] text-fg-muted font-normal truncate" title={`Code: ${hospital.hospital_code}`}>
                                                        Code: {hospital.hospital_code}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </td>
                                    <td className="px-4 sm:px-6 py-3.5 sm:py-4 text-fg-muted">
                                        {hospital.province || '-'}
                                    </td>
                                    <td className="px-4 sm:px-6 py-3.5 sm:py-4 text-fg-muted max-w-[12rem] truncate" title={hospital.premium_tier || undefined}>
                                        {hospital.premium_tier || '-'}
                                    </td>
                                    <td className="px-4 sm:px-6 py-3.5 sm:py-4 text-center">
                                        {Number(hospital.transfers) > 0 ? (
                                            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-semantic-danger/10 text-semantic-danger">
                                                {hospital.transfers}
                                            </span>
                                        ) : (
                                            <span className="text-fg-muted">-</span>
                                        )}
                                    </td>
                                    <td className="px-4 sm:px-6 py-3.5 sm:py-4 text-right">
                                        <div className="flex items-center justify-end gap-3">
                                            <span className="font-mono text-fg-primary">{formatNumber(currentVolume)}</span>
                                            <div className="w-16 sm:w-24 h-1.5 bg-brand-card-hover rounded-full overflow-hidden">
                                                <div
                                                    className="h-full bg-brand-accent rounded-full opacity-80"
                                                    style={{ width: `${percentage}%` }}
                                                />
                                            </div>
                                        </div>
                                    </td>
                                    {showComparisonColumns && (
                                        <td className="px-4 sm:px-6 py-3.5 sm:py-4 text-right">
                                            {typeof prevPeriodVolume === 'number' ? (
                                                <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${getComparisonBadgeClasses(currentVolume, prevPeriodVolume)}`}>
                                                    {formatNumber(prevPeriodVolume)}
                                                </span>
                                            ) : (
                                                <span className="text-fg-muted">-</span>
                                            )}
                                        </td>
                                    )}
                                    {showPrevYearColumn && (
                                        <td className="px-4 sm:px-6 py-3.5 sm:py-4 text-right">
                                            {typeof prevYearVolume === 'number' ? (
                                                <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${getComparisonBadgeClasses(currentVolume, prevYearVolume)}`}>
                                                    {formatNumber(prevYearVolume)}
                                                </span>
                                            ) : (
                                                <span className="text-fg-muted">-</span>
                                            )}
                                        </td>
                                    )}
                                </tr>
                            );
                        })}
                        {visibleHospitals.length === 0 && (
                            <tr>
                                <td colSpan={colSpan} className="px-4 sm:px-6 py-8 text-center text-fg-muted">
                                    No hospitals found
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
};
