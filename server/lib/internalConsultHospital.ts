/**
 * Consults without a resolvable customer hospital are stored under this code (internal / PriceSmart bucket).
 * Legacy rows may still use hospital_code = 'Unknown'. Both are excluded from dashboard analytics.
 */
export const INTERNAL_CONSULT_HOSPITAL_CODE = 'PRICESMART';

export const INTERNAL_CONSULT_HOSPITAL_NAME = 'PriceSmart';

/** SQL predicate (no bind params). Append with AND. */
export const SQL_EXCLUDE_INTERNAL_HOSPITAL_CONSULTS =
    "hospital_code NOT IN ('Unknown', 'PRICESMART')";
