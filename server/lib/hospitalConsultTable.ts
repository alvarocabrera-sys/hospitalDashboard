import type { Client, PoolClient } from 'pg';

type DbClient = Client | PoolClient;

/** Hospital-dashboard ingest + analytics only (store app keeps using `consult_fact`). */
export const CONSULT_FACT_HOSPITAL_TABLE = 'consult_fact_hospital';

export const ensureHospitalConsultTable = async (client: DbClient): Promise<void> => {
    await client.query(`
        CREATE TABLE IF NOT EXISTS consult_fact_hospital (
            consult_id TEXT PRIMARY KEY,
            created_date TIMESTAMPTZ NOT NULL,
            month_bucket TEXT,
            corporate_profile TEXT,
            hospital_ref TEXT,
            hospital_code TEXT,
            premium_tier TEXT,
            country TEXT,
            province TEXT,
            species TEXT,
            transferred BOOLEAN,
            for_testing BOOLEAN,
            modified_date TIMESTAMPTZ,
            consult_date_time TIMESTAMPTZ,
            claimed_at TIMESTAMPTZ
        )
    `);

    await client.query(`
        ALTER TABLE consult_fact_hospital
        ADD COLUMN IF NOT EXISTS hospital_ref TEXT
    `);
    await client.query(`
        ALTER TABLE consult_fact_hospital
        ADD COLUMN IF NOT EXISTS consult_date_time TIMESTAMPTZ
    `);
    await client.query(`
        ALTER TABLE consult_fact_hospital
        ADD COLUMN IF NOT EXISTS hospital_code TEXT
    `);
    await client.query(`
        ALTER TABLE consult_fact_hospital
        ADD COLUMN IF NOT EXISTS premium_tier TEXT
    `);
    await client.query(`
        ALTER TABLE consult_fact_hospital
        ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ
    `);
    await client.query(`
        ALTER TABLE consult_fact_hospital
        ADD COLUMN IF NOT EXISTS hospital_internal_name TEXT
    `);
    await client.query(`
        ALTER TABLE consult_fact_hospital
        ADD COLUMN IF NOT EXISTS hospital_unknown_reason TEXT
    `);

    await backfillHospitalFromLegacy(client);
};

async function getLegacyConsultFactClaimColumn(client: DbClient): Promise<string | null> {
    const result = await client.query<{ column_name: string }>(`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'consult_fact'
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
    `);
    return result.rows[0]?.column_name ?? null;
}

async function backfillHospitalFromLegacy(client: DbClient): Promise<void> {
    const legacy = await client.query<{ exists: boolean }>(`
        SELECT EXISTS (
            SELECT 1
            FROM information_schema.tables
            WHERE table_schema = 'public'
              AND table_name = 'consult_fact'
        ) AS exists
    `);
    if (!legacy.rows[0]?.exists) {
        return;
    }

    const columns = await client.query<{ column_name: string }>(`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'consult_fact'
    `);
    const colSet = new Set(columns.rows.map((r) => r.column_name));
    if (!colSet.has('consult_id')) {
        return;
    }

    let hospitalCodeExpr: string;
    if (colSet.has('hospital_code')) {
        if (colSet.has('store_id')) {
            hospitalCodeExpr = `COALESCE(NULLIF(TRIM(c.hospital_code), ''), NULLIF(TRIM(c.store_id), ''))`;
        } else {
            hospitalCodeExpr = 'c.hospital_code';
        }
    } else if (colSet.has('store_id')) {
        hospitalCodeExpr = 'c.store_id';
    } else {
        hospitalCodeExpr = 'NULL::text';
    }

    const premiumTierExpr = colSet.has('premium_tier') ? 'c.premium_tier' : 'NULL::text';
    const consultDtExpr = colSet.has('consult_date_time') ? 'c.consult_date_time' : 'NULL::timestamptz';

    const legacyClaimColumn = await getLegacyConsultFactClaimColumn(client);
    const claimedAtExpr = legacyClaimColumn ? `c.${legacyClaimColumn}` : 'NULL::timestamptz';

    await client.query(`
        INSERT INTO consult_fact_hospital (
            consult_id, created_date, month_bucket, corporate_profile,
            hospital_ref, hospital_code, hospital_internal_name, hospital_unknown_reason, premium_tier,
            country, province, species, transferred, for_testing, modified_date, consult_date_time,
            claimed_at
        )
        SELECT
            c.consult_id,
            c.created_date,
            c.month_bucket,
            c.corporate_profile,
            NULL::text,
            ${hospitalCodeExpr},
            NULL::text,
            NULL::text,
            ${premiumTierExpr},
            c.country,
            c.province,
            c.species,
            c.transferred,
            c.for_testing,
            c.modified_date,
            ${consultDtExpr},
            ${claimedAtExpr}
        FROM consult_fact c
        WHERE c.corporate_profile = 'PetSmart'
        ON CONFLICT (consult_id) DO NOTHING
    `);
}

/** Single-row table: timestamp after last successful Bubble consultation pull (incremental cursor). */
export const HOSPITAL_INGESTION_CHECKPOINT_TABLE = 'hospital_ingestion_checkpoint';

export const ensureIngestionCheckpointTable = async (client: DbClient): Promise<void> => {
    await client.query(`
        CREATE TABLE IF NOT EXISTS ${HOSPITAL_INGESTION_CHECKPOINT_TABLE} (
            id INTEGER PRIMARY KEY DEFAULT 1,
            last_sync_at TIMESTAMPTZ NOT NULL,
            CONSTRAINT hospital_ingestion_checkpoint_singleton CHECK (id = 1)
        )
    `);
};

/**
 * ISO string for Bubble "greater than" constraints, or null to run a full sync.
 * When no checkpoint exists but fact rows do, seeds checkpoint from MAX(created, modified).
 */
export const getIncrementalAfterIsoForIngestion = async (
    client: DbClient,
    forceFullSync: boolean
): Promise<string | null> => {
    if (forceFullSync) {
        return null;
    }

    await ensureIngestionCheckpointTable(client);

    const existing = await client.query<{ last_sync_at: Date | null }>(
        `SELECT last_sync_at FROM ${HOSPITAL_INGESTION_CHECKPOINT_TABLE} WHERE id = 1`
    );
    const row = existing.rows[0];
    if (row?.last_sync_at) {
        const d = new Date(row.last_sync_at);
        return Number.isNaN(d.getTime()) ? null : d.toISOString();
    }

    const maxR = await client.query<{ t: string | null }>(`
        SELECT MAX(GREATEST(created_date, COALESCE(modified_date, created_date)))::text AS t
        FROM ${CONSULT_FACT_HOSPITAL_TABLE}
        WHERE corporate_profile = 'PetSmart' AND for_testing = false
    `);
    const t = maxR.rows[0]?.t;
    if (!t) {
        return null;
    }
    const parsed = new Date(t);
    if (Number.isNaN(parsed.getTime())) {
        return null;
    }
    const iso = parsed.toISOString();
    await client.query(
        `INSERT INTO ${HOSPITAL_INGESTION_CHECKPOINT_TABLE} (id, last_sync_at)
         VALUES (1, $1::timestamptz)
         ON CONFLICT (id) DO NOTHING`,
        [iso]
    );
    return iso;
};

/**
 * Sets checkpoint to the latest consult activity in the warehouse (created vs modified),
 * so the next incremental pull does not skip rows whose Bubble dates are behind wall clock.
 */
export const refreshIngestionCheckpointFromFact = async (client: DbClient): Promise<void> => {
    await ensureIngestionCheckpointTable(client);
    await client.query(`
        INSERT INTO ${HOSPITAL_INGESTION_CHECKPOINT_TABLE} (id, last_sync_at)
        SELECT
            1,
            COALESCE(
                (SELECT MAX(GREATEST(created_date, COALESCE(modified_date, created_date)))
                 FROM ${CONSULT_FACT_HOSPITAL_TABLE}
                 WHERE corporate_profile = 'PetSmart' AND for_testing = false),
                NOW()
            )
        ON CONFLICT (id) DO UPDATE SET last_sync_at = EXCLUDED.last_sync_at
    `);
};
