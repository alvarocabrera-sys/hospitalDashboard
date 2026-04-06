/**
 * Dashboard chart palette — aligned with CSS variables / design tokens.
 * Primary = highlighted / current metrics (orange); blues = secondary series.
 */
export const chartTheme = {
    bg: 'var(--bg-surface)',
    grid: 'var(--border-color)',
    axis: 'var(--text-muted)',
    tooltipFg: 'var(--text-primary)',
    /** Primary dataset / highlight */
    primary: 'var(--color-primary)',
    secondary: 'var(--blue-primary)',
    tertiary: 'var(--blue-secondary)',
    quaternary: 'var(--blue-soft)',
    neutral: 'var(--color-data-neutral)'
} as const;

export const chartSpeciesColors = [
    chartTheme.primary,
    chartTheme.secondary,
    chartTheme.tertiary,
    chartTheme.quaternary,
    chartTheme.neutral,
    'var(--color-primary-soft)'
];
