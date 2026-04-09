import { useMemo } from 'react';
import type { HospitalComparisonData, HospitalData, HospitalDisplayByCode } from '../types';
import { formatNumber } from '../lib/utils';
import { useFullscreenFrame } from './FullscreenFrame';

interface StoreCheckInWidgetProps {
    hospitals?: HospitalData[];
    allHospitals?: HospitalData[];
    comparisons?: HospitalComparisonData;
    /** Resolved internal names for codes (from GET /hospitals/display), including non-top-10 hospitals */
    displayByCode?: HospitalDisplayByCode;
    loading: boolean;
    comparisonLabel?: string;
    yearLabel?: string;
    maxItems?: number;
}

interface DecliningHospital {
    hospitalCode: string;
    current: number;
    prevPeriod: number;
    prevYear?: number;
    dropVsPrev: number;
    dropVsYear?: number;
}

export const StoreCheckInWidget = ({
    hospitals,
    allHospitals,
    comparisons,
    displayByCode,
    loading,
    comparisonLabel = 'Prev Period',
    yearLabel,
    maxItems = 10
}: StoreCheckInWidgetProps) => {
    const isFullscreen = useFullscreenFrame();
    const loadingHeightClass = isFullscreen ? 'h-[65vh]' : 'h-[240px]';

    const decliningHospitals = useMemo<DecliningHospital[]>(() => {
        if (!hospitals || !comparisons?.prevPeriodByHospital) {
            return [];
        }

        const currentByHospital = new Map<string, number>();
        hospitals.forEach((hospital) => {
            currentByHospital.set(hospital.hospital_code, Number(hospital.volume) || 0);
        });

        const hospitalCodes = new Set<string>([
            ...Object.keys(comparisons.prevPeriodByHospital),
            ...currentByHospital.keys()
        ]);

        const rows: DecliningHospital[] = [];
        hospitalCodes.forEach((hospitalCode) => {
            const current = currentByHospital.get(hospitalCode) ?? 0;
            const prevPeriod = comparisons.prevPeriodByHospital[hospitalCode] ?? 0;
            if (prevPeriod <= 0 || current >= prevPeriod) {
                return;
            }

            const prevYear = comparisons.prevYearByHospital?.[hospitalCode];
            const dropVsPrev = prevPeriod - current;
            const dropVsYear = typeof prevYear === 'number' && current < prevYear ? prevYear - current : 0;

            rows.push({
                hospitalCode,
                current,
                prevPeriod,
                prevYear,
                dropVsPrev,
                dropVsYear
            });
        });

        return rows
            .sort((a, b) => {
                if (b.dropVsPrev !== a.dropVsPrev) {
                    return b.dropVsPrev - a.dropVsPrev;
                }
                return (b.dropVsYear ?? 0) - (a.dropVsYear ?? 0);
            })
            .slice(0, maxItems);
    }, [hospitals, comparisons, maxItems]);

    const internalNameFor = (code: string) => {
        const fromBatch = displayByCode?.[code]?.hospital_internal_name?.trim();
        if (fromBatch) return fromBatch;
        const fromTop = hospitals?.find((h) => h.hospital_code === code)?.hospital_internal_name?.trim();
        if (fromTop) return fromTop;
        const fromCatalog = allHospitals?.find((h) => h.hospital_code === code)?.hospital_internal_name?.trim();
        return fromCatalog || code;
    };

    if (loading) {
        return <div className={`${loadingHeightClass} w-full bg-brand-card/50 rounded-xl border border-subtle animate-pulse`} />;
    }

    return (
        <div className={`bg-brand-card border border-subtle rounded-xl p-4 sm:p-6 shadow-card ${isFullscreen ? 'min-h-[65vh]' : ''}`.trim()}>
            <div className="mb-4 sm:mb-5">
                <h3 className="text-base sm:text-lg font-medium text-fg-primary">Hospitals to check in with</h3>
                <p className="text-xs text-fg-muted mt-1">Top {maxItems} declining hospitals by consultation volume vs {comparisonLabel.toLowerCase()}.</p>
            </div>

            {!comparisons?.prevPeriodByHospital ? (
                <div className="text-sm text-fg-muted">
                    Choose a date-range view to compare hospital performance.
                </div>
            ) : decliningHospitals.length === 0 ? (
                <div className="text-sm text-fg-muted">
                    No declining hospitals found for this period.
                </div>
            ) : (
                <div className="overflow-auto">
                    <table className={`w-full ${yearLabel ? 'min-w-[880px]' : 'min-w-[720px]'} text-left text-sm`}>
                        <thead className="text-fg-muted border-b border-subtle">
                            <tr>
                                <th className="py-2 pr-4 font-medium">Internal name</th>
                                <th className="py-2 pr-4 font-medium">Code</th>
                                <th className="py-2 px-2 font-medium text-right">Current</th>
                                <th className="py-2 px-2 font-medium text-right">{comparisonLabel}</th>
                                <th className="py-2 px-2 font-medium text-right">Drop</th>
                                {yearLabel && (
                                    <>
                                        <th className="py-2 px-2 font-medium text-right whitespace-nowrap">{yearLabel}</th>
                                        <th className="py-2 pl-2 font-medium text-right">Drop LY</th>
                                    </>
                                )}
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-subtle">
                            {decliningHospitals.map((row) => {
                                const internal = internalNameFor(row.hospitalCode);
                                return (
                                    <tr key={row.hospitalCode}>
                                        <td className="py-2.5 pr-4 text-fg-primary font-medium min-w-0 max-w-[14rem] truncate" title={internal}>
                                            {internal}
                                        </td>
                                        <td className="py-2.5 pr-4 font-mono text-fg-secondary whitespace-nowrap">{row.hospitalCode}</td>
                                        <td className="py-2.5 px-2 text-right font-mono text-fg-secondary">{formatNumber(row.current)}</td>
                                        <td className="py-2.5 px-2 text-right font-mono text-fg-secondary">{formatNumber(row.prevPeriod)}</td>
                                        <td className="py-2.5 px-2 text-right">
                                            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-semantic-danger/10 text-semantic-danger">
                                                -{formatNumber(row.dropVsPrev)}
                                            </span>
                                        </td>
                                        {yearLabel && (
                                            <>
                                                <td className="py-2.5 px-2 text-right font-mono text-fg-secondary">
                                                    {typeof row.prevYear === 'number' ? formatNumber(row.prevYear) : '-'}
                                                </td>
                                                <td className="py-2.5 pl-2 text-right">
                                                    {typeof row.dropVsYear === 'number' && row.dropVsYear > 0 ? (
                                                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-semantic-danger/10 text-semantic-danger">
                                                            -{formatNumber(row.dropVsYear)}
                                                        </span>
                                                    ) : (
                                                        <span className="text-fg-muted">-</span>
                                                    )}
                                                </td>
                                            </>
                                        )}
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
};
