import { Client } from 'pg';
import axios, { AxiosError } from 'axios';
import {
    CONSULT_FACT_HOSPITAL_TABLE,
    ensureHospitalConsultTable,
    getIncrementalAfterIsoForIngestion,
    refreshIngestionCheckpointFromFact
} from './hospitalConsultTable.js';
import { INTERNAL_CONSULT_HOSPITAL_CODE, INTERNAL_CONSULT_HOSPITAL_NAME } from './internalConsultHospital.js';

// --- Types ---

interface BubbleConsultation {
    _id: string;
    "Created Date": string;
    "Modified Date": string;
    "Consult Date / Time"?: string;
    "Consult Date/Time"?: string;
    "Consult Date Time"?: string;
    "Consult Date"?: string;
    "Claimed at"?: string;
    "Claimed At"?: string;
    "Claimed Date"?: string;
    "Claimed date"?: string;
    "Corporate Profile": string;
    accreditedFacility: string;
    Species: string;
    "Transferred?": boolean;
    "For testing?": boolean;
    "Service Region Offering": string;
    "User Profile"?: string;
    "Created By"?: string;
    Client?: string;
    "Primary care hospital"?: string;
    "Referred by hospital"?: string;
}


interface BubbleHospitalResponse {
    _id?: string;
    Code?: string;
    Name?: string;
    "#"?: number;
    "Internal Name"?: string;
    "Internal name"?: string;
    /** Option set display; source field in Bubble is `OS_Premium Tier` */
    "Premium Tier"?: string;
    "OS_Premium Tier"?: string;
}

type HospitalUnknownReason = 'no_hospital_ref' | 'bubble_lookup_failed' | 'missing_identifiers';

interface HospitalResolved {
    code: string;
    internalName: string | null;
    premiumTier: string | null;
    unknownReason: HospitalUnknownReason | null;
}

/** Consults without a resolvable hospital: stored as internal bucket, excluded from analytics. */
const resolvedInternalConsultHospital = (): HospitalResolved => ({
    code: INTERNAL_CONSULT_HOSPITAL_CODE,
    internalName: INTERNAL_CONSULT_HOSPITAL_NAME,
    premiumTier: null,
    unknownReason: null
});

const getBubbleHospitalInternalNameField = () =>
    process.env.BUBBLE_HOSPITAL_INTERNAL_NAME_FIELD ?? 'Internal Name';

const pickInternalNameFromHospital = (h: BubbleHospitalResponse): string | undefined => {
    const key = getBubbleHospitalInternalNameField();
    const raw = (h as Record<string, unknown>)[key];
    if (typeof raw === 'string' && raw.trim() !== '') {
        return raw.trim();
    }
    const legacy = h["Internal Name"] ?? h["Internal name"];
    if (typeof legacy === 'string' && legacy.trim() !== '') {
        return legacy.trim();
    }
    return undefined;
};

const pickPremiumTier = (h: BubbleHospitalResponse): string | null => {
    const a = h["Premium Tier"];
    const b = h["OS_Premium Tier"];
    const s =
        (typeof a === "string" && a.trim() !== "" ? a.trim() : undefined)
        ?? (typeof b === "string" && b.trim() !== "" ? b.trim() : undefined);
    return s ?? null;
};

interface BubbleConstraint {
    key: string;
    constraint_type: 'equals' | 'is_empty' | 'greater than';
    value?: string;
}

interface ConstraintConfig {
    trackingStatusField: string;
    trackingStatusValue: string;
    cancelledAtField: string;
    modifiedDateField: string;
    createdDateField: string;
}

interface ConstraintProbeStep {
    label: string;
    constraints: BubbleConstraint[];
}

interface BubbleCollectionResponse<T> {
    response: {
        results: T[];
        remaining: number;
        count: number;
    };
}

interface BubbleRegion {
    _id: string;
    Region?: string;
}

export type IncrementalIngestionPhase = 'modified' | 'created';

export interface IngestionOptions {
    forceFullSync?: boolean;
    /** @deprecated Prefer incrementalResume; still used as modified-phase cursor when incrementalResume is omitted */
    startCursor?: number;
    /** Resume Bubble pagination after a timeout (cursor is only valid for the given phase). */
    incrementalResume?: { phase: IncrementalIngestionPhase; cursor: number };
}

export interface IngestionResult {
    processed: number;
    status: string;
    remaining: number;
    nextCursor: number;
    timedOut: boolean;
    incrementalResume?: { phase: IncrementalIngestionPhase; cursor: number };
}

const getBubbleApiBaseUrl = () =>
    (process.env.BUBBLE_API_BASE_URL ?? 'https://app.getvetwise.com/api/1.1').replace(/\/+$/, '');

const getBubbleObjectsUrl = () => `${getBubbleApiBaseUrl()}/obj`;

const getBubbleConsultationUrl = () => `${getBubbleObjectsUrl()}/Consultation`;

const getConstraintConfig = (): ConstraintConfig => ({
    trackingStatusField: process.env.BUBBLE_TRACKING_STATUS_FIELD ?? 'Tracking Status',
    trackingStatusValue: process.env.BUBBLE_TRACKING_STATUS_VALUE ?? 'Complete',
    cancelledAtField: process.env.BUBBLE_CANCELLED_AT_FIELD ?? 'Cancelled at',
    modifiedDateField: process.env.BUBBLE_MODIFIED_DATE_FIELD ?? 'Modified Date',
    createdDateField: process.env.BUBBLE_CREATED_DATE_FIELD ?? 'Created Date'
});

const buildBaseConsultationConstraints = (config: ConstraintConfig): BubbleConstraint[] => [
    { key: config.trackingStatusField, constraint_type: 'equals', value: config.trackingStatusValue },
    { key: config.cancelledAtField, constraint_type: 'is_empty' }
];

const getConstraintProbeSteps = (
    config: ConstraintConfig,
    lastModified?: string
): ConstraintProbeStep[] => {
    const steps: ConstraintProbeStep[] = [];
    const baseConstraints = buildBaseConsultationConstraints(config);

    baseConstraints.forEach((_, index) => {
        steps.push({
            label: baseConstraints[index].key,
            constraints: baseConstraints.slice(0, index + 1)
        });
    });

    if (lastModified) {
        steps.push({
            label: config.modifiedDateField,
            constraints: [
                ...baseConstraints,
                {
                    key: config.modifiedDateField,
                    constraint_type: 'greater than',
                    value: lastModified
                }
            ]
        });
        steps.push({
            label: config.createdDateField,
            constraints: [
                ...baseConstraints,
                {
                    key: config.createdDateField,
                    constraint_type: 'greater than',
                    value: lastModified
                }
            ]
        });
    }

    return steps;
};

const getErrorDetails = (error: unknown) => {
    if (error instanceof AxiosError) {
        return error.response?.data ?? error.message;
    }

    if (error instanceof Error) {
        return error.message;
    }

    return String(error);
};

const logConstraintProbeFailure = async (
    bubbleApiUrl: string,
    bubbleToken: string,
    config: ConstraintConfig,
    lastModified?: string,
    sortFieldForProbe?: string
) => {
    console.log('Bubble rejected the consultation query. Probing constraints incrementally...');
    const sortField = sortFieldForProbe ?? config.modifiedDateField;

    for (const step of getConstraintProbeSteps(config, lastModified)) {
        try {
            await axios.get<BubbleCollectionResponse<BubbleConsultation>>(bubbleApiUrl, {
                params: {
                    constraints: JSON.stringify(step.constraints),
                    cursor: 0,
                    limit: 1,
                    sort_field: sortField,
                    descending: false
                },
                headers: {
                    Authorization: `Bearer ${bubbleToken}`
                }
            });

            console.log(`Constraint probe passed: ${step.label}`);
        } catch (error) {
            console.error(`Constraint probe failed at: ${step.label}`);
            console.error('Probe request constraints:', step.constraints);
            console.error('Probe error details:', getErrorDetails(error));
            return;
        }
    }

    console.log('All incremental constraint probes passed.');
};

const getMonthBucket = (dateStr: string): string => {
    const d = new Date(dateStr);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    return `${yyyy}-${mm}`;
};

const parseRegion = (region: string | undefined): { country: string; province: string } => {
    if (!region) return { country: 'Unknown', province: 'Unknown' };

    // Handle "Ontario, CA" (Pro/Country) or "Ontario - CA"
    // Split by comma or dash
    const parts = region.split(/[,-]+/).map(s => s.trim());

    if (parts.length >= 2) {
        // "Ontario, CA" -> parts[0]=Ontario, parts[1]=CA
        return { country: parts[1], province: parts[0] };
    }
    return { country: 'Unknown', province: region };
};

const getClaimedAtValue = (item: BubbleConsultation): string | null => {
    const candidate = item["Claimed at"]
        ?? item["Claimed At"]
        ?? item["Claimed Date"]
        ?? item["Claimed date"];

    if (typeof candidate !== 'string') {
        return null;
    }

    const trimmed = candidate.trim();
    return trimmed.length > 0 ? trimmed : null;
};

const getConsultDateTimeValue = (item: BubbleConsultation): string | null => {
    const candidate = item["Consult Date / Time"]
        ?? item["Consult Date/Time"]
        ?? item["Consult Date Time"]
        ?? item["Consult Date"];

    if (typeof candidate !== 'string') {
        return null;
    }

    const trimmed = candidate.trim();
    return trimmed.length > 0 ? trimmed : null;
};

// --- Helpers ---

const fetchAllPages = async <T extends { _id: string }>(
    token: string,
    objectName: string,
    constraints: BubbleConstraint[] = []
): Promise<T[]> => {
    let allResults: T[] = [];
    let cursor = 0;
    let remaining = 1;
    const bubbleObjectsUrl = getBubbleObjectsUrl();

    console.log(`Caching reference table: ${objectName}...`);

    while (remaining > 0) {
        try {
            const response = await axios.get<BubbleCollectionResponse<T>>(`${bubbleObjectsUrl}/${objectName}`, {
                params: {
                    constraints: JSON.stringify(constraints),
                    cursor: cursor,
                    limit: 100
                },
                headers: { Authorization: `Bearer ${token}` }
            });
            const data = response.data.response;
            allResults = [...allResults, ...data.results];
            remaining = data.remaining;
            cursor += data.count;
        } catch (err) {
            console.error(`Failed to fetch ${objectName}:`, err);
            break;
        }
    }
    console.log(`Cached ${allResults.length} records for ${objectName}.`);
    return allResults;
};

// Added maxDurationMs for local runs
export const runIngestion = async (
    bubbleToken: string,
    dbUrl: string,
    maxDurationMs: number = 20000,
    options: IngestionOptions = {}
) => {
    // Wall clock for the whole run (region prefetch, DB, and per-row Hospital lookups all count).
    const wallStart = Date.now();
    const overBudget = () => Date.now() - wallStart > maxDurationMs;

    console.log(`Starting ingestion (Timeout: ${maxDurationMs}ms)...`);
    console.log(`Bubble base URL: ${getBubbleApiBaseUrl()}`);
    const constraintConfig = getConstraintConfig();
    console.log('Bubble constraint config:', constraintConfig);
    const forceFullSync = options.forceFullSync === true;
    const startCursorCandidate = options.startCursor ?? 0;
    const initialCursor = Number.isFinite(startCursorCandidate) ? Math.max(0, Math.floor(startCursorCandidate)) : 0;
    const resume = options.incrementalResume;

    const regionsRaw = await fetchAllPages<BubbleRegion>(bubbleToken, "ServiceRegionOffering");
    const regionMap = new Map<string, string>();
    regionsRaw.forEach((r) => {
        if (r.Region) regionMap.set(r._id, r.Region);
    });

    const bubbleObjectsUrl = getBubbleObjectsUrl();

    const hospitalCache = new Map<string, HospitalResolved>();

    const resolveHospital = async (hospitalBubbleId?: string): Promise<HospitalResolved> => {
        if (!hospitalBubbleId || !hospitalBubbleId.trim()) {
            return resolvedInternalConsultHospital();
        }
        const id = hospitalBubbleId.trim();
        if (hospitalCache.has(id)) {
            return hospitalCache.get(id)!;
        }
        try {
            const res = await axios.get<{ response: BubbleHospitalResponse }>(`${bubbleObjectsUrl}/Hospital/${id}`, {
                headers: { Authorization: `Bearer ${bubbleToken}` }
            });
            const h = res.data.response;
            const code =
                (typeof h.Code === "string" && h.Code.trim() !== "" ? h.Code.trim() : undefined)
                ?? (typeof h["#"] === "number" ? String(h["#"]) : undefined)
                ?? (typeof h.Name === "string" && h.Name.trim() !== "" ? h.Name.trim() : undefined)
                ?? "Unknown";
            const fromInternal = pickInternalNameFromHospital(h);
            const internalName =
                fromInternal
                ?? (typeof h.Name === "string" && h.Name.trim() !== "" ? h.Name.trim() : null);
            if (code === "Unknown") {
                const resolved = resolvedInternalConsultHospital();
                hospitalCache.set(id, resolved);
                return resolved;
            }
            const resolved: HospitalResolved = {
                code,
                internalName,
                premiumTier: pickPremiumTier(h),
                unknownReason: null
            };
            hospitalCache.set(id, resolved);
            return resolved;
        } catch {
            return resolvedInternalConsultHospital();
        }
    };

    console.log(`Loaded Cache: ${regionMap.size} Regions.`);

    const client = new Client({ connectionString: dbUrl });
    let successCount = 0;
    const bubbleApiUrl = getBubbleConsultationUrl();

    try {
        await client.connect();

        await ensureHospitalConsultTable(client);

        const claimedColumnResult = await client.query<{ column_name: string }>(`
            SELECT column_name
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = $1
              AND (
                  column_name IN ('claimed_at', 'claimed_date', 'claim_at', 'claimedat')
                  OR column_name LIKE 'claimed%'
                  OR column_name LIKE 'claim%'
              )
            ORDER BY
                CASE column_name
                    WHEN 'claimed_at' THEN 0
                    WHEN 'claimed_date' THEN 1
                    WHEN 'claim_at' THEN 2
                    WHEN 'claimedat' THEN 3
                    ELSE 4
                END,
                ordinal_position ASC
            LIMIT 1
        `, [CONSULT_FACT_HOSPITAL_TABLE]);

        const claimedTimestampColumn = claimedColumnResult.rows[0]?.column_name;

        const incrementalIso = await getIncrementalAfterIsoForIngestion(client, forceFullSync);
        if (forceFullSync) {
            console.log('Force full sync: pulling all matching records (checkpoint will refresh after success).');
        } else if (incrementalIso) {
            console.log(
                `Incremental sync: ${constraintConfig.modifiedDateField} > ${incrementalIso} OR ${constraintConfig.createdDateField} > ${incrementalIso} (from saved checkpoint).`
            );
        } else {
            console.log('No checkpoint yet: running initial full sync.');
        }

        console.log(`Ingestion using max duration: ${maxDurationMs}ms (wall clock from run start)`);

        const queryText = claimedTimestampColumn
            ? `
                INSERT INTO ${CONSULT_FACT_HOSPITAL_TABLE} (
                    consult_id, created_date, month_bucket, corporate_profile,
                    hospital_ref, hospital_code, hospital_internal_name, hospital_unknown_reason, premium_tier, country, province, species, transferred,
                    for_testing, modified_date, consult_date_time, ${claimedTimestampColumn}
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
                ON CONFLICT (consult_id) DO UPDATE SET
                    created_date = EXCLUDED.created_date,
                    month_bucket = EXCLUDED.month_bucket,
                    corporate_profile = EXCLUDED.corporate_profile,
                    hospital_ref = EXCLUDED.hospital_ref,
                    hospital_code = EXCLUDED.hospital_code,
                    hospital_internal_name = EXCLUDED.hospital_internal_name,
                    hospital_unknown_reason = EXCLUDED.hospital_unknown_reason,
                    premium_tier = EXCLUDED.premium_tier,
                    country = EXCLUDED.country,
                    province = EXCLUDED.province,
                    species = EXCLUDED.species,
                    transferred = EXCLUDED.transferred,
                    for_testing = EXCLUDED.for_testing,
                    modified_date = EXCLUDED.modified_date,
                    consult_date_time = EXCLUDED.consult_date_time,
                    ${claimedTimestampColumn} = EXCLUDED.${claimedTimestampColumn};
            `
            : `
                INSERT INTO ${CONSULT_FACT_HOSPITAL_TABLE} (
                    consult_id, created_date, month_bucket, corporate_profile,
                    hospital_ref, hospital_code, hospital_internal_name, hospital_unknown_reason, premium_tier, country, province, species, transferred,
                    for_testing, modified_date, consult_date_time
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
                ON CONFLICT (consult_id) DO UPDATE SET
                    created_date = EXCLUDED.created_date,
                    month_bucket = EXCLUDED.month_bucket,
                    corporate_profile = EXCLUDED.corporate_profile,
                    hospital_ref = EXCLUDED.hospital_ref,
                    hospital_code = EXCLUDED.hospital_code,
                    hospital_internal_name = EXCLUDED.hospital_internal_name,
                    hospital_unknown_reason = EXCLUDED.hospital_unknown_reason,
                    premium_tier = EXCLUDED.premium_tier,
                    country = EXCLUDED.country,
                    province = EXCLUDED.province,
                    species = EXCLUDED.species,
                    transferred = EXCLUDED.transferred,
                    for_testing = EXCLUDED.for_testing,
                    modified_date = EXCLUDED.modified_date,
                    consult_date_time = EXCLUDED.consult_date_time;
            `;

        const baseConstraints = buildBaseConsultationConstraints(constraintConfig);

        const runFetchPhase = async (
            phaseLabel: string,
            phaseConstraints: BubbleConstraint[],
            sortField: string,
            startCursor: number
        ): Promise<{ nextCursor: number; remaining: number; timedOut: boolean }> => {
            let cursorStart = startCursor;
            let remaining = 1;
            let timedOut = false;

            while (remaining > 0) {
                if (overBudget()) {
                    console.log(`Time nearing limit (${phaseLabel}), stopping. Next run will continue.`);
                    timedOut = true;
                    break;
                }

                console.log(`[${phaseLabel}] Fetching page at cursor ${cursorStart}...`);
                let response: { data: BubbleCollectionResponse<BubbleConsultation> };
                try {
                    response = await axios.get<BubbleCollectionResponse<BubbleConsultation>>(bubbleApiUrl, {
                        params: {
                            constraints: JSON.stringify(phaseConstraints),
                            cursor: cursorStart,
                            limit: 100,
                            sort_field: sortField,
                            descending: false
                        },
                        headers: {
                            Authorization: `Bearer ${bubbleToken}`
                        }
                    });
                } catch (error) {
                    if (error instanceof AxiosError && error.response?.status === 400) {
                        const gt = phaseConstraints.find((c) => c.constraint_type === 'greater than');
                        await logConstraintProbeFailure(
                            bubbleApiUrl,
                            bubbleToken,
                            constraintConfig,
                            gt?.value,
                            sortField
                        );
                    }

                    throw error;
                }

                const data = response.data.response;
                const results = data.results as BubbleConsultation[];

                if (results.length === 0) {
                    remaining = 0;
                    break;
                }

                let batchSuccess = 0;
                let advanceCursor = true;
                for (const item of results) {
                    if (overBudget()) {
                        console.log(`Time nearing limit mid-batch (${phaseLabel}), same cursor will retry.`);
                        timedOut = true;
                        advanceCursor = false;
                        break;
                    }

                    const regionId = item["Service Region Offering"];
                    let regionStr = regionMap.get(regionId);

                    if (!regionStr && regionId) {
                        try {
                            const rRes = await axios.get<{ response: { Region?: string } }>(
                                `${bubbleObjectsUrl}/ServiceRegionOffering/${regionId}`,
                                {
                                    headers: { Authorization: `Bearer ${bubbleToken}` }
                                }
                            );
                            regionStr = rRes.data.response.Region;
                            if (regionStr) regionMap.set(regionId, regionStr);
                        } catch {
                            console.log(`Failed to resolve Region JIT: ${regionId}`);
                        }
                    }

                    const regionObj = parseRegion(regionStr || regionId);

                    const hospitalBubbleId =
                        item["Primary care hospital"]?.trim() || item["Referred by hospital"]?.trim();
                    const {
                        code: hospitalCode,
                        internalName: hospitalInternalName,
                        premiumTier,
                        unknownReason: hospitalUnknownReason
                    } = await resolveHospital(hospitalBubbleId);
                    const hospitalRef = hospitalBubbleId && hospitalBubbleId.length > 0 ? hospitalBubbleId : null;

                    const params: Array<string | boolean | null> = [
                        item._id,
                        item["Created Date"],
                        getMonthBucket(item["Created Date"]),
                        "PetSmart",
                        hospitalRef,
                        hospitalCode,
                        hospitalInternalName,
                        hospitalUnknownReason,
                        premiumTier,
                        regionObj.country,
                        regionObj.province,
                        item.Species,
                        item["Transferred?"],
                        item["For testing?"],
                        item["Modified Date"],
                        getConsultDateTimeValue(item)
                    ];

                    if (claimedTimestampColumn) {
                        params.push(getClaimedAtValue(item));
                    }

                    try {
                        await client.query(queryText, params);
                        successCount++;
                        batchSuccess++;
                    } catch (err) {
                        console.error(`Failed to upsert ${item._id}:`, err);
                    }
                }

                remaining = data.remaining;
                if (advanceCursor) {
                    cursorStart += data.count;
                }

                console.log(`[${phaseLabel}] Upserted: ${batchSuccess}. Remaining in Bubble: ${remaining}`);
            }

            return { nextCursor: cursorStart, remaining, timedOut };
        };

        let bubbleRemaining = 0;
        let nextCursorOut = initialCursor;
        let timedOut = false;
        let incrementalResumeOut: IngestionResult['incrementalResume'];

        if (forceFullSync || !incrementalIso) {
            const r = await runFetchPhase('full', baseConstraints, constraintConfig.modifiedDateField, initialCursor);
            bubbleRemaining = r.remaining;
            nextCursorOut = r.nextCursor;
            timedOut = r.timedOut;
        } else {
            if (resume?.phase !== 'created') {
                const modifiedStart = resume?.phase === 'modified' ? resume.cursor : initialCursor;
                const rMod = await runFetchPhase(
                    'incremental-modified',
                    [
                        ...baseConstraints,
                        {
                            key: constraintConfig.modifiedDateField,
                            constraint_type: 'greater than',
                            value: incrementalIso
                        }
                    ],
                    constraintConfig.modifiedDateField,
                    modifiedStart
                );
                bubbleRemaining = rMod.remaining;
                nextCursorOut = rMod.nextCursor;
                timedOut = rMod.timedOut;
                if (timedOut) {
                    incrementalResumeOut = { phase: 'modified', cursor: rMod.nextCursor };
                }
            }

            if (!timedOut) {
                const createdStart = resume?.phase === 'created' ? resume.cursor : 0;
                const rCre = await runFetchPhase(
                    'incremental-created',
                    [
                        ...baseConstraints,
                        {
                            key: constraintConfig.createdDateField,
                            constraint_type: 'greater than',
                            value: incrementalIso
                        }
                    ],
                    constraintConfig.createdDateField,
                    createdStart
                );
                bubbleRemaining = rCre.remaining;
                nextCursorOut = rCre.nextCursor;
                timedOut = rCre.timedOut;
                if (timedOut) {
                    incrementalResumeOut = { phase: 'created', cursor: rCre.nextCursor };
                } else {
                    incrementalResumeOut = undefined;
                }
            }
        }

        const finishedCleanly = !timedOut && bubbleRemaining === 0;
        if (finishedCleanly) {
            await refreshIngestionCheckpointFromFact(client);
            console.log('Ingestion checkpoint refreshed from latest consult created/modified timestamps.');
        }

        console.log(`Ingestion cycle complete. Total upserted in this run: ${successCount}.`);
        return {
            processed: successCount,
            status: 'success',
            remaining: bubbleRemaining,
            nextCursor: nextCursorOut,
            timedOut,
            incrementalResume: incrementalResumeOut
        };

    } finally {
        await client.end();
    }
};

export interface IngestionPassSummary {
    totalProcessed: number;
    passes: number;
    remaining: number;
    lastTimedOut: boolean;
    nextCursor: number;
    incrementalResume?: { phase: IncrementalIngestionPhase; cursor: number };
    /** True when stopped early to stay under a serverless wall-clock limit (e.g. Vercel maxDuration). */
    wallBudgetExceeded?: boolean;
}

/**
 * Run ingestion in a loop until Bubble queue is drained or max passes.
 * Continues using incrementalResume (modified/created phase + cursor) or nextCursor for full sync.
 */
const CRON_HTTP_RESPONSE_MARGIN_MS = 8000;
const CRON_MIN_PASS_MS = 5000;

export const runIngestionPasses = async (
    bubbleToken: string,
    dbUrl: string,
    perPassMaxDurationMs: number,
    options: {
        forceFullSync?: boolean;
        maxPasses?: number;
        startCursor?: number;
        incrementalResume?: { phase: IncrementalIngestionPhase; cursor: number };
        /**
         * Total wall time for this invocation (ms). When set, each pass uses
         * min(perPassMaxDurationMs, remainingBudget) so serverless functions return before the platform timeout.
         */
        maxTotalWallMs?: number;
    } = {}
): Promise<IngestionPassSummary> => {
    const maxPasses = options.maxPasses ?? 20;
    const start = options.startCursor;
    let cursor = typeof start === 'number' && Number.isFinite(start) ? Math.max(0, Math.floor(start)) : 0;
    let incrementalResume = options.incrementalResume;
    let totalProcessed = 0;
    let passes = 0;
    let remaining = 1;
    let lastTimedOut = false;
    let wallBudgetExceeded = false;

    const wallStart = Date.now();
    const maxTotalWallMs = options.maxTotalWallMs;

    while (passes < maxPasses && remaining > 0) {
        let thisPassMs = perPassMaxDurationMs;
        if (maxTotalWallMs !== undefined) {
            const elapsed = Date.now() - wallStart;
            const remainingWall = maxTotalWallMs - elapsed;
            if (remainingWall <= CRON_HTTP_RESPONSE_MARGIN_MS) {
                wallBudgetExceeded = true;
                break;
            }
            thisPassMs = Math.min(perPassMaxDurationMs, remainingWall - CRON_HTTP_RESPONSE_MARGIN_MS);
            if (thisPassMs < CRON_MIN_PASS_MS) {
                wallBudgetExceeded = true;
                break;
            }
        }

        const result = await runIngestion(bubbleToken, dbUrl, thisPassMs, {
            forceFullSync: options.forceFullSync === true,
            startCursor: incrementalResume ? 0 : cursor,
            incrementalResume
        });
        totalProcessed += result.processed;
        remaining = result.remaining;
        lastTimedOut = result.timedOut;
        if (result.incrementalResume) {
            incrementalResume = result.incrementalResume;
            cursor = result.incrementalResume.cursor;
        } else {
            incrementalResume = undefined;
            cursor = result.nextCursor;
        }
        passes += 1;
        if (!result.timedOut && result.remaining === 0) {
            break;
        }
    }

    return {
        totalProcessed,
        passes,
        remaining,
        lastTimedOut,
        nextCursor: cursor,
        incrementalResume,
        ...(wallBudgetExceeded ? { wallBudgetExceeded: true } : {})
    };
};
