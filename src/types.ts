export interface DashboardMetrics {
    totalConsults: number;
    /** All analytics-eligible PetSmart consult rows in the warehouse (ignores date filters). */
    petSmartConsultWarehouseTotal: number;
    totalHospitals: number;
    activeHospitals: number;
    inactiveHospitals: number;
    totalTransfers: number;
    consultsTrendMoM?: number;
    consultsTrendYoY?: number;
    consultsDeltaMoM?: number;
    consultsDeltaYoY?: number;
    hospitalsTrendMoM?: number;
    hospitalsTrendYoY?: number;
    activeHospitalsTrendMoM?: number;
    activeHospitalsTrendYoY?: number;
    activeHospitalsDeltaMoM?: number;
    activeHospitalsDeltaYoY?: number;
    inactiveHospitalsTrendMoM?: number;
    inactiveHospitalsTrendYoY?: number;
    inactiveHospitalsDeltaMoM?: number;
    inactiveHospitalsDeltaYoY?: number;
    transfersTrendMoM?: number;
    transfersTrendYoY?: number;
    transfersDeltaMoM?: number;
    transfersDeltaYoY?: number;

    lastUpdated?: string;
    lastConsult?: string;
}

export interface ChartData {
    date: string;
    count: number;
}

export interface ComparisonSeries {
    startDate: string;
    endDate: string;
    data: ChartData[];
}

export interface VolumeComparisons {
    prevMonth?: ComparisonSeries;
    prevYear: ComparisonSeries;
}

export interface HospitalData {
    hospital_code: string;
    /** Bubble Hospital internal name at ingest; optional on legacy rows */
    hospital_internal_name?: string | null;
    province?: string;
    /** From Bubble Hospital `Premium Tier` / `OS_Premium Tier` at ingest time */
    premium_tier?: string | null;
    volume: number;
    transfers: number;
}

export interface HospitalComparisonData {
    prevPeriodByHospital: Record<string, number>;
    prevYearByHospital?: Record<string, number>;
}

/** Batch lookup from GET /hospitals/display */
export interface HospitalDisplayRow {
    hospital_code: string;
    hospital_internal_name: string | null;
}

export type HospitalDisplayByCode = Record<string, { hospital_internal_name: string | null }>;

export interface SpeciesData {
    species: string;
    count: number;
}

export interface WaitTimeDailyPoint {
    date: string;
    avgWaitMinutes: number;
}

export interface WaitTimeSpeciesPoint {
    species: string;
    avgWaitMinutes: number;
}

export interface WaitTimeProvincePoint {
    province: string;
    avgWaitMinutes: number;
}

export interface Consultation {
    consult_id: string;
    created_date: string;
    month_bucket: string;
    corporate_profile: string;
    /** Bubble `Hospital` id from consult (stable ref); see `consult_fact_hospital` */
    hospital_ref?: string | null;
    hospital_code: string;
    premium_tier?: string | null;
    country: string;
    province: string;
    species: string;
    transferred: boolean;
    for_testing: boolean;
}

export interface DashboardFilters {
    month?: string;
    startDate?: string;
    endDate?: string;
    country?: string;
    province?: string;
    hospital_code?: string;
    species?: string;
    /** Hospital Premium Tier (Bubble option set), matches `consult_fact_hospital.premium_tier` */
    premium_tier?: string;
}
