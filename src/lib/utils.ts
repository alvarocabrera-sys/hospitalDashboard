import axios from 'axios';
import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

export const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
    }).format(value);
};

export const formatNumber = (value: number) => {
    return new Intl.NumberFormat('en-US').format(value);
};

/** Primary label for hospital rows: internal name when present, else store code. */
export const hospitalDisplayPrimary = (h: { hospital_code: string; hospital_internal_name?: string | null }) => {
    const internal = h.hospital_internal_name?.trim();
    return internal || h.hospital_code;
};

export const hospitalShowCodeSubtitle = (h: { hospital_code: string; hospital_internal_name?: string | null }) =>
    Boolean(h.hospital_internal_name?.trim());

export const formatQueryError = (err: unknown): string => {
    if (axios.isAxiosError(err)) {
        const data = err.response?.data;
        if (data && typeof data === 'object' && 'error' in data && typeof (data as { error: unknown }).error === 'string') {
            return (data as { error: string }).error;
        }
        return err.message;
    }
    if (err instanceof Error) {
        return err.message;
    }
    return 'Something went wrong';
};
