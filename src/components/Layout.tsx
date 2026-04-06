import React, { useEffect, useState } from 'react';
import { LayoutDashboard, RefreshCw } from 'lucide-react';
import { cn, formatNumber } from '../lib/utils';
import { formatDistance } from 'date-fns';

interface LayoutProps {
    children: React.ReactNode;
    onRefresh?: () => void;
    isRefreshing?: boolean;
    lastUpdated?: string;
    lastConsult?: string;
    /** Global PetSmart consult count in warehouse (analytics scope). */
    petSmartConsultWarehouseTotal?: number;
}

export const Layout = ({
    children,
    onRefresh,
    isRefreshing,
    lastUpdated,
    lastConsult,
    petSmartConsultWarehouseTotal
}: LayoutProps) => {
    const [clockNow, setClockNow] = useState(() => Date.now());

    useEffect(() => {
        const timer = window.setInterval(() => {
            setClockNow(Date.now());
        }, 60_000);

        return () => window.clearInterval(timer);
    }, []);

    const formatLastUpdated = (value?: string) => {
        if (!value) return 'N/A';
        const relative = formatDistance(new Date(value), clockNow, { addSuffix: true });
        return relative.includes('less than a minute') ? 'just updated' : relative;
    };

    return (
        <div className="min-h-screen bg-brand-bg text-fg-primary font-sans selection:bg-brand-accent/30">
            <nav className="border-b border-subtle bg-brand-card/90 backdrop-blur-xl sticky top-0 z-50">
                <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8">
                    <div className="py-2.5">
                        <div className="flex items-center justify-between gap-3">
                            <div className="flex items-center gap-2.5 min-w-0">
                                <div className="p-1.5 sm:p-2 bg-brand-accent/10 rounded-lg shrink-0">
                                    <LayoutDashboard className="h-5 w-5 sm:h-6 sm:w-6 text-brand-accent" />
                                </div>
                                <span className="text-base sm:text-xl font-bold text-fg-primary tracking-tight truncate">
                                    Hospital Analytics
                                </span>
                            </div>

                            <div className="flex items-center gap-3 sm:gap-4">
                                {onRefresh && (
                                    <button
                                        onClick={onRefresh}
                                        disabled={isRefreshing}
                                        aria-busy={isRefreshing}
                                        className={cn(
                                            "p-2 rounded-lg text-fg-muted transition-dashboard shrink-0 md:hidden",
                                            isRefreshing
                                                ? "cursor-wait text-brand-accent"
                                                : "hover:bg-brand-card-hover hover:text-brand-accent"
                                        )}
                                        title={isRefreshing ? "Refreshing data..." : "Refresh data"}
                                    >
                                        <RefreshCw className={cn("h-4 w-4", isRefreshing && "animate-spin")} />
                                    </button>
                                )}

                                <div className="hidden md:flex items-center gap-4 text-xs text-fg-muted whitespace-nowrap">
                                    {onRefresh && (
                                        <button
                                            onClick={onRefresh}
                                            disabled={isRefreshing}
                                            aria-busy={isRefreshing}
                                            className={cn(
                                                "p-1.5 rounded-lg text-fg-muted transition-dashboard shrink-0",
                                                isRefreshing
                                                    ? "cursor-wait text-brand-accent"
                                                    : "hover:bg-brand-card-hover hover:text-brand-accent"
                                            )}
                                            title={isRefreshing ? "Refreshing data..." : "Refresh data"}
                                        >
                                            <RefreshCw className={cn("h-4 w-4", isRefreshing && "animate-spin")} />
                                        </button>
                                    )}
                                    <div>
                                        Last updated: <span className="text-fg-secondary font-mono">
                                            {formatLastUpdated(lastUpdated)}
                                        </span>
                                    </div>
                                    <div>
                                        Last consult: <span className="text-brand-accent font-mono font-medium">
                                            {lastConsult ? formatDistance(new Date(lastConsult), clockNow, { addSuffix: true }) : 'N/A'}
                                        </span>
                                    </div>
                                    <div>
                                        PetSmart consults (warehouse):{' '}
                                        <span className="text-fg-secondary font-mono font-medium">
                                            {petSmartConsultWarehouseTotal !== undefined
                                                ? formatNumber(petSmartConsultWarehouseTotal)
                                                : '—'}
                                        </span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </nav>
            <main className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-5 sm:py-8">
                {children}
            </main>
        </div>
    );
};
