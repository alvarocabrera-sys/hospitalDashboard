import serverless from 'serverless-http';
import express, { Router } from 'express';
import crypto from 'crypto';
import { Client } from 'pg';
import dotenv from 'dotenv';
import path from 'path';
import { CONSULT_FACT_HOSPITAL_TABLE, ensureHospitalConsultTable } from '../server/lib/hospitalConsultTable.js';
import { SQL_EXCLUDE_INTERNAL_HOSPITAL_CONSULTS } from '../server/lib/internalConsultHospital.js';
import { runIngestion, runIngestionPasses } from '../server/lib/ingestion.js';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const app = express();
const router = Router();
app.set('trust proxy', true);
app.use(express.json());

const SESSION_COOKIE_NAME = 'ps_dash_session';
const SESSION_TTL_SECONDS = 8 * 60 * 60;
const AUTH_WINDOW_MS = 15 * 60 * 1000;
const AUTH_BLOCK_MS = 30 * 60 * 1000;
const AUTH_MAX_ATTEMPTS = 5;
const PUBLIC_ROUTE_PATHS = new Set(['/auth/login', '/auth/session', '/auth/logout', '/ingest', '/cron/ingest']);

// --- DB Helper ---

/** Prefer Bubble hospital id when present; else display code for legacy backfill rows. */
const hospitalEntityGroupExpr = `COALESCE(NULLIF(TRIM(hospital_ref), ''), NULLIF(TRIM(hospital_code), ''))`;

const getClient = async () => {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
        throw new Error('DATABASE_URL is not configured');
    }

    const configuredConnectTimeout = Number(process.env.PG_CONNECT_TIMEOUT_MS ?? '10000');
    const connectionTimeoutMillis = Number.isFinite(configuredConnectTimeout)
        ? Math.min(60000, Math.max(1000, Math.floor(configuredConnectTimeout)))
        : 10000;

    const configuredQueryTimeout = Number(process.env.PG_QUERY_TIMEOUT_MS ?? '15000');
    const queryTimeoutMs = Number.isFinite(configuredQueryTimeout)
        ? Math.min(120000, Math.max(1000, Math.floor(configuredQueryTimeout)))
        : 15000;

    const client = new Client({
        connectionString,
        connectionTimeoutMillis,
        query_timeout: queryTimeoutMs,
        statement_timeout: queryTimeoutMs,
        keepAlive: true
    });
    await client.connect();
    await ensureHospitalConsultTable(client);
    return client;
};

interface ClaimColumnMeta {
    columnName: string;
    dataType: string;
}

interface ConsultColumnMeta {
    columnName: string;
    dataType: string;
}

interface AuthTokenPayload {
    exp?: number;
}

const getClaimedTimestampColumn = async (client: Client): Promise<ClaimColumnMeta | null> => {
    const result = await client.query<{ column_name: string; data_type: string }>(`
        SELECT column_name, data_type
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

    const row = result.rows[0];
    if (!row) {
        return null;
    }

    return {
        columnName: row.column_name,
        dataType: row.data_type
    };
};

const getConsultDateTimeColumn = async (client: Client): Promise<ConsultColumnMeta | null> => {
    const result = await client.query<{ column_name: string; data_type: string }>(`
        SELECT column_name, data_type
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = $1
          AND (
              column_name IN ('consult_date_time', 'consult_datetime', 'consult_date')
              OR column_name LIKE 'consult%date%time%'
              OR column_name LIKE 'consult%datetime%'
          )
        ORDER BY
            CASE column_name
                WHEN 'consult_date_time' THEN 0
                WHEN 'consult_datetime' THEN 1
                WHEN 'consult_date' THEN 2
                ELSE 3
            END,
            ordinal_position ASC
            LIMIT 1
    `, [CONSULT_FACT_HOSPITAL_TABLE]);

    const row = result.rows[0];
    if (!row) {
        return null;
    }

    return {
        columnName: row.column_name,
        dataType: row.data_type
    };
};

const getWaitMinutesExpression = (claimColumn: ClaimColumnMeta, consultColumn: ConsultColumnMeta | null) => {
    if (consultColumn && claimColumn.dataType !== 'date') {
        return `
            CASE
                WHEN ${consultColumn.columnName} IS NOT NULL
                    THEN EXTRACT(EPOCH FROM (${claimColumn.columnName} - ${consultColumn.columnName})) / 60.0
                ELSE EXTRACT(EPOCH FROM (${claimColumn.columnName} - created_date)) / 60.0
            END
        `;
    }

    if (claimColumn.dataType === 'date') {
        return `EXTRACT(EPOCH FROM ((${claimColumn.columnName}::date - created_date::date) * interval '1 day')) / 60.0`;
    }

    return `EXTRACT(EPOCH FROM (${claimColumn.columnName} - created_date)) / 60.0`;
};

const getHeaderValue = (value: string | string[] | undefined) => {
    if (Array.isArray(value)) {
        return value[0];
    }
    return value;
};

const getIngestAuthToken = (req: express.Request) => {
    const headerToken = getHeaderValue(req.headers['x-ingest-key']);
    if (headerToken) {
        return headerToken;
    }

    const authHeader = getHeaderValue(req.headers.authorization);
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return undefined;
    }

    return authHeader.slice('Bearer '.length).trim();
};

const getDashboardAuthToken = (req: express.Request) => {
    const authHeader = getHeaderValue(req.headers.authorization);
    if (authHeader && authHeader.startsWith('Bearer ')) {
        return authHeader.slice('Bearer '.length).trim();
    }

    return getCookies(req)[SESSION_COOKIE_NAME];
};

const getDashboardPassword = () => process.env.DASHBOARD_PASSWORD ?? 'VetWise!2000';

const getAuthSecret = () =>
    process.env.DASHBOARD_AUTH_SECRET
    ?? process.env.BUBBLE_API_TOKEN
    ?? process.env.DATABASE_URL
    ?? 'ps-dashboard-auth-secret';

const sha256 = (value: string) => crypto.createHash('sha256').update(value).digest();

const isPasswordValid = (providedPassword: string) => {
    const providedHash = sha256(providedPassword);
    const expectedHash = sha256(getDashboardPassword());
    return crypto.timingSafeEqual(providedHash, expectedHash);
};

const getCookies = (req: express.Request) => {
    const cookieHeader = req.headers.cookie;
    if (!cookieHeader) {
        return {};
    }

    return cookieHeader.split(';').reduce<Record<string, string>>((acc, part) => {
        const [rawName, ...rest] = part.trim().split('=');
        if (!rawName || rest.length === 0) {
            return acc;
        }

        acc[rawName] = decodeURIComponent(rest.join('='));
        return acc;
    }, {});
};

const toBase64Url = (value: Buffer | string) =>
    Buffer.from(value)
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/g, '');

const fromBase64Url = (value: string) => {
    const padded = value.replace(/-/g, '+').replace(/_/g, '/');
    const padLength = (4 - (padded.length % 4)) % 4;
    return Buffer.from(`${padded}${'='.repeat(padLength)}`, 'base64');
};

const signSessionToken = () => {
    const payload = JSON.stringify({
        exp: Date.now() + (SESSION_TTL_SECONDS * 1000)
    });
    const encodedPayload = toBase64Url(payload);
    const signature = toBase64Url(
        crypto.createHmac('sha256', getAuthSecret()).update(encodedPayload).digest()
    );

    return `${encodedPayload}.${signature}`;
};

const isValidSignedToken = (token: string) => {
    if (!token) {
        return false;
    }

    const [encodedPayload, signature] = token.split('.');
    if (!encodedPayload || !signature) {
        return false;
    }

    const expectedSignature = toBase64Url(
        crypto.createHmac('sha256', getAuthSecret()).update(encodedPayload).digest()
    );

    if (signature.length !== expectedSignature.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) {
        return false;
    }

    try {
        const payload = JSON.parse(fromBase64Url(encodedPayload).toString('utf8')) as AuthTokenPayload;
        return typeof payload.exp === 'number' && payload.exp > Date.now();
    } catch {
        return false;
    }
};

const hasValidSession = (req: express.Request) => isValidSignedToken(getDashboardAuthToken(req) ?? '');

const isSecureRequest = (req: express.Request) => {
    const forwardedProto = getHeaderValue(req.headers['x-forwarded-proto']);
    return req.secure || forwardedProto === 'https';
};

const buildSessionCookie = (req: express.Request, token: string) =>
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; Max-Age=${SESSION_TTL_SECONDS}; Path=/; HttpOnly; SameSite=Lax${isSecureRequest(req) ? '; Secure' : ''}`;

const buildExpiredSessionCookie = (req: express.Request) =>
    `${SESSION_COOKIE_NAME}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax${isSecureRequest(req) ? '; Secure' : ''}`;

const getClientIp = (req: express.Request) => {
    const forwarded = getHeaderValue(req.headers['x-forwarded-for']);
    if (forwarded) {
        return forwarded.split(',')[0].trim();
    }
    return req.ip || 'unknown';
};

const ensureAuthTable = async (client: Client) => {
    await client.query(`
        CREATE TABLE IF NOT EXISTS dashboard_auth_attempts (
            ip_address TEXT PRIMARY KEY,
            attempts INTEGER NOT NULL DEFAULT 0,
            window_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            blocked_until TIMESTAMPTZ,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);
};

const requireDashboardSession = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (PUBLIC_ROUTE_PATHS.has(req.path)) {
        next();
        return;
    }

    if (!hasValidSession(req)) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
    }

    next();
};

// --- Filters Middleware/Helper ---
// We'll construct WHERE clauses based on query params.

const buildWhereClause = (req: express.Request, options?: { includeDate?: boolean }) => {
    const includeDate = options?.includeDate ?? true;
    const { month, startDate, endDate, country, province, hospital_code, species, premium_tier } = req.query;
    const conditions: string[] = [
        "corporate_profile = 'PetSmart'",
        "for_testing = false",
        SQL_EXCLUDE_INTERNAL_HOSPITAL_CONSULTS
    ];
    const values: string[] = [];
    let paramIdx = 1;

    if (includeDate) {
        if (startDate && typeof startDate === 'string') {
            conditions.push(`created_date >= $${paramIdx++}::date`);
            values.push(startDate);
        }
        if (endDate && typeof endDate === 'string') {
            conditions.push(`created_date < ($${paramIdx++}::date + interval '1 day')`);
            values.push(endDate);
        }
        // Fallback to month if distinct range not provided
        if (month && typeof month === 'string' && !startDate && !endDate) {
            conditions.push(`month_bucket = $${paramIdx++}`);
            values.push(month);
        }
    }

    if (country && typeof country === 'string') {
        conditions.push(`country = $${paramIdx++}`);
        values.push(country);
    }
    if (province && typeof province === 'string') {
        conditions.push(`province = $${paramIdx++}`);
        values.push(province);
    }
    if (hospital_code && typeof hospital_code === 'string') {
        conditions.push(`hospital_code = $${paramIdx++}`);
        values.push(hospital_code);
    }
    if (species && typeof species === 'string') {
        conditions.push(`species = $${paramIdx++}`);
        values.push(species);
    }
    if (premium_tier && typeof premium_tier === 'string') {
        conditions.push(`premium_tier = $${paramIdx++}`);
        values.push(premium_tier);
    }

    return {
        text: conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '',
        values
    };
};

const MAX_HOSPITAL_DISPLAY_CODES = 150;

/** Scope for label lookup: no date/hospital_code filter so names resolve from full history. */
const buildHospitalDisplayWhereClause = (req: express.Request) => {
    const { country, province, species, premium_tier } = req.query;
    const conditions: string[] = [
        "corporate_profile = 'PetSmart'",
        "for_testing = false",
        SQL_EXCLUDE_INTERNAL_HOSPITAL_CONSULTS
    ];
    const values: string[] = [];
    let paramIdx = 1;
    if (country && typeof country === 'string') {
        conditions.push(`country = $${paramIdx++}`);
        values.push(country);
    }
    if (province && typeof province === 'string') {
        conditions.push(`province = $${paramIdx++}`);
        values.push(province);
    }
    if (species && typeof species === 'string') {
        conditions.push(`species = $${paramIdx++}`);
        values.push(species);
    }
    if (premium_tier && typeof premium_tier === 'string') {
        conditions.push(`premium_tier = $${paramIdx++}`);
        values.push(premium_tier);
    }
    return {
        text: `WHERE ${conditions.join(' AND ')}`,
        values,
        nextParamIdx: paramIdx
    };
};

const parseHospitalCodesQuery = (req: express.Request): string[] => {
    const out = new Set<string>();
    const codesParam = req.query.codes;
    if (typeof codesParam === 'string' && codesParam.trim()) {
        codesParam.split(',').forEach((c) => {
            const t = c.trim();
            if (t) out.add(t);
        });
    }
    const singleCode = req.query.code;
    if (typeof singleCode === 'string' && singleCode.trim()) {
        out.add(singleCode.trim());
    } else if (Array.isArray(singleCode)) {
        singleCode.forEach((c) => {
            if (typeof c === 'string' && c.trim()) out.add(c.trim());
        });
    }
    return [...out].slice(0, MAX_HOSPITAL_DISPLAY_CODES);
};

// --- Routes ---

router.get('/auth/session', (req, res) => {
    if (!hasValidSession(req)) {
        res.status(401).json({ authenticated: false });
        return;
    }

    res.json({ authenticated: true });
});

router.post('/auth/login', async (req, res) => {
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const ipAddress = getClientIp(req);
    let client: Client | null = null;

    try {
        client = await getClient();
        await ensureAuthTable(client);
        await client.query('BEGIN');

        const attemptResult = await client.query<{
            attempts: number;
            window_started_at: string;
            blocked_until: string | null;
        }>(
            `
                SELECT attempts, window_started_at, blocked_until
                FROM dashboard_auth_attempts
                WHERE ip_address = $1
                FOR UPDATE
            `,
            [ipAddress]
        );

        const now = Date.now();
        const existing = attemptResult.rows[0];
        const blockedUntil = existing?.blocked_until ? new Date(existing.blocked_until).getTime() : 0;

        if (blockedUntil > now) {
            await client.query('COMMIT');
            const retryAfterSeconds = Math.ceil((blockedUntil - now) / 1000);
            res.status(429).json({
                error: 'Too many failed attempts.',
                retryAfterSeconds
            });
            return;
        }

        if (!isPasswordValid(password)) {
            const windowStartedAt = existing?.window_started_at ? new Date(existing.window_started_at).getTime() : now;
            const withinWindow = existing && (now - windowStartedAt) <= AUTH_WINDOW_MS;
            const attempts = withinWindow ? existing.attempts + 1 : 1;
            const nextWindowStartedAt = withinWindow ? new Date(windowStartedAt) : new Date(now);
            const nextBlockedUntil = attempts >= AUTH_MAX_ATTEMPTS ? new Date(now + AUTH_BLOCK_MS) : null;

            await client.query(
                `
                    INSERT INTO dashboard_auth_attempts (ip_address, attempts, window_started_at, blocked_until, updated_at)
                    VALUES ($1, $2, $3, $4, NOW())
                    ON CONFLICT (ip_address) DO UPDATE SET
                        attempts = EXCLUDED.attempts,
                        window_started_at = EXCLUDED.window_started_at,
                        blocked_until = EXCLUDED.blocked_until,
                        updated_at = NOW()
                `,
                [ipAddress, attempts, nextWindowStartedAt.toISOString(), nextBlockedUntil?.toISOString() ?? null]
            );

            await client.query('COMMIT');

            if (nextBlockedUntil) {
                res.status(429).json({
                    error: 'Too many failed attempts.',
                    retryAfterSeconds: Math.ceil((nextBlockedUntil.getTime() - now) / 1000)
                });
                return;
            }

            res.status(401).json({ error: 'Incorrect password.' });
            return;
        }

        await client.query('DELETE FROM dashboard_auth_attempts WHERE ip_address = $1', [ipAddress]);
        await client.query('COMMIT');

        const token = signSessionToken();
        res.setHeader('Set-Cookie', buildSessionCookie(req, token));
        res.json({ authenticated: true, token });
    } catch (err) {
        if (client) {
            await client.query('ROLLBACK').catch(() => undefined);
        }
        console.error(err);
        res.status(500).json({ error: 'Unable to authenticate.' });
    } finally {
        if (client) {
            await client.end();
        }
    }
});

router.post('/auth/logout', (req, res) => {
    res.setHeader('Set-Cookie', buildExpiredSessionCookie(req));
    res.json({ authenticated: false });
});

/** Vercel Cron (GET) — secured with CRON_SECRET; replaces Netlify scheduled function. */
router.get('/cron/ingest', async (req, res) => {
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret) {
        res.status(503).json({ error: 'CRON_SECRET is not configured' });
        return;
    }
    const bearer = getIngestAuthToken(req);
    if (!bearer || bearer !== cronSecret) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
    }

    const token = process.env.BUBBLE_API_TOKEN;
    const dbUrl = process.env.DATABASE_URL;

    if (!token || !dbUrl) {
        console.error('[cron/ingest] missing BUBBLE_API_TOKEN or DATABASE_URL');
        res.status(500).json({ error: 'Missing server configuration' });
        return;
    }

    try {
        const configuredMaxDuration = Number(process.env.INGEST_MAX_DURATION_MS ?? '8000');
        const perPassMs = Number.isFinite(configuredMaxDuration) ? Math.max(5000, configuredMaxDuration) : 8000;
        const configuredMaxPasses = Number(process.env.INGEST_SCHEDULE_MAX_PASSES ?? '12');
        const maxPasses = Number.isFinite(configuredMaxPasses) ? Math.min(40, Math.max(1, configuredMaxPasses)) : 12;

        /** Stay under Vercel `functions.*.maxDuration` (seconds); default 280s with margin before 300s kill. */
        const defaultCronWallMs = 280_000;
        const parsedCronWall = Number(process.env.CRON_INGEST_MAX_WALL_MS ?? String(defaultCronWallMs));
        const maxTotalWallMs = Number.isFinite(parsedCronWall)
            ? Math.min(295_000, Math.max(30_000, parsedCronWall))
            : defaultCronWallMs;

        const summary = await runIngestionPasses(token, dbUrl, perPassMs, { maxPasses, maxTotalWallMs });
        if (summary.wallBudgetExceeded) {
            console.warn(
                '[cron/ingest] stopped before max passes: wall budget (remaining work will continue on next cron tick)'
            );
        }
        console.log('[cron/ingest] scheduled ingestion summary:', summary);
        res.json({ ok: true, ...summary });
    } catch (err) {
        console.error('[cron/ingest] failed:', err);
        res.status(500).json({ error: String(err) });
    }
});

router.use(requireDashboardSession);

router.get('/metrics', async (req, res) => {
    const client = await getClient();
    try {
        const { startDate, endDate } = req.query;
        const where = buildWhereClause(req);

        // -- Queries for Current Period --

        // 1. Total Volume
        const volQuery = `SELECT COUNT(*) as total FROM ${CONSULT_FACT_HOSPITAL_TABLE} ${where.text}`;
        const volRes = await client.query(volQuery, where.values);
        const totalConsults = parseInt(volRes.rows[0].total, 10);

        // 2. Transfers
        const transferWhere = where.text ? `${where.text} AND transferred = true` : `WHERE transferred = true`;
        const transferQuery = `SELECT COUNT(*) as total FROM ${CONSULT_FACT_HOSPITAL_TABLE} ${transferWhere}`;
        const transferRes = await client.query(transferQuery, where.values);
        const totalTransfers = parseInt(transferRes.rows[0].total, 10);

        // 3. Active/Inactive Hospitals
        const activeHospitalsQuery = `SELECT COUNT(DISTINCT ${hospitalEntityGroupExpr}) as active_count FROM ${CONSULT_FACT_HOSPITAL_TABLE} ${where.text}`;
        const activeRes = await client.query(activeHospitalsQuery, where.values);
        const activeHospitals = parseInt(activeRes.rows[0].active_count, 10);

        // Total Hospitals (Global PetSmart Scope)
        const totalHospitalsQuery = `SELECT COUNT(DISTINCT ${hospitalEntityGroupExpr}) as total_count FROM ${CONSULT_FACT_HOSPITAL_TABLE} WHERE corporate_profile = 'PetSmart' AND for_testing = false AND ${SQL_EXCLUDE_INTERNAL_HOSPITAL_CONSULTS}`;
        const totalHospitalsRes = await client.query(totalHospitalsQuery);
        const totalHospitals = parseInt(totalHospitalsRes.rows[0].total_count, 10);

        const warehouseConsultsQuery = `SELECT COUNT(*)::text AS total FROM ${CONSULT_FACT_HOSPITAL_TABLE} WHERE corporate_profile = 'PetSmart' AND for_testing = false AND ${SQL_EXCLUDE_INTERNAL_HOSPITAL_CONSULTS}`;
        const warehouseConsultsRes = await client.query<{ total: string }>(warehouseConsultsQuery);
        const petSmartConsultWarehouseTotal = parseInt(warehouseConsultsRes.rows[0].total, 10);

        const inactiveHospitals = Math.max(0, totalHospitals - activeHospitals);

        // -- Trends Calculation --
        const trends = {
            consultsTrendMoM: 0, consultsTrendYoY: 0,
            consultsDeltaMoM: 0, consultsDeltaYoY: 0,
            activeHospitalsTrendMoM: 0, activeHospitalsTrendYoY: 0,
            activeHospitalsDeltaMoM: 0, activeHospitalsDeltaYoY: 0,
            inactiveHospitalsTrendMoM: 0, inactiveHospitalsTrendYoY: 0,
            inactiveHospitalsDeltaMoM: 0, inactiveHospitalsDeltaYoY: 0,
            transfersTrendMoM: 0, transfersTrendYoY: 0,
            transfersDeltaMoM: 0, transfersDeltaYoY: 0
        };

        if (startDate && typeof startDate === 'string' && endDate && typeof endDate === 'string') {
            const start = new Date(startDate);
            const end = new Date(endDate);
            const durationMs = end.getTime() - start.getTime();

            // Helper to get stats for a date range
            const getStats = async (sStr: string, eStr: string, includeEndDate: boolean = true) => {
                const { country, province, hospital_code, species, premium_tier } = req.query;
                const conditions: string[] = [
                    "corporate_profile = 'PetSmart'",
                    "for_testing = false",
                    SQL_EXCLUDE_INTERNAL_HOSPITAL_CONSULTS
                ];
                const values: string[] = [];
                let paramIdx = 1;

                conditions.push(`created_date >= $${paramIdx++}::date`);
                values.push(sStr);
                if (includeEndDate) {
                    conditions.push(`created_date < ($${paramIdx++}::date + interval '1 day')`);
                } else {
                    conditions.push(`created_date < $${paramIdx++}::date`);
                }
                values.push(eStr);

                if (country && typeof country === 'string') { conditions.push(`country = $${paramIdx++}`); values.push(country); }
                if (province && typeof province === 'string') { conditions.push(`province = $${paramIdx++}`); values.push(province); }
                if (hospital_code && typeof hospital_code === 'string') { conditions.push(`hospital_code = $${paramIdx++}`); values.push(hospital_code); }
                if (species && typeof species === 'string') { conditions.push(`species = $${paramIdx++}`); values.push(species); }
                if (premium_tier && typeof premium_tier === 'string') { conditions.push(`premium_tier = $${paramIdx++}`); values.push(premium_tier); }

                const wText = `WHERE ${conditions.join(' AND ')}`;

                const vQ = `SELECT COUNT(*) as total FROM ${CONSULT_FACT_HOSPITAL_TABLE} ${wText}`;
                const vR = await client.query(vQ, values);
                const tConsults = parseInt(vR.rows[0].total, 10);

                const trWhere = `${wText} AND transferred = true`;
                const trQ = `SELECT COUNT(*) as total FROM ${CONSULT_FACT_HOSPITAL_TABLE} ${trWhere}`;
                const trR = await client.query(trQ, values);
                const tTransfers = parseInt(trR.rows[0].total, 10);

                const aQ = `SELECT COUNT(DISTINCT ${hospitalEntityGroupExpr}) as active_count FROM ${CONSULT_FACT_HOSPITAL_TABLE} ${wText}`;
                const aR = await client.query(aQ, values);
                const aHospitals = parseInt(aR.rows[0].active_count, 10);

                return { tConsults, tTransfers, aHospitals };
            };

            // 1. Previous Period (MoM / PoP)
            const prevEndMoM = new Date(start.getTime());
            const prevStartMoM = new Date(prevEndMoM.getTime() - durationMs);

            // 2. Year Ago (YoY)
            const prevStartYoY = new Date(start.getTime());
            prevStartYoY.setFullYear(start.getFullYear() - 1);

            const prevEndYoY = new Date(endDate);
            prevEndYoY.setFullYear(end.getFullYear() - 1);

            const prevMoM = await getStats(
                prevStartMoM.toISOString().split('T')[0],
                prevEndMoM.toISOString().split('T')[0],
                false // Start of current period (exclusive)
            );

            const prevYoY = await getStats(
                prevStartYoY.toISOString().split('T')[0],
                prevEndYoY.toISOString().split('T')[0],
                true // Inclusive for YoY
            );

            const calcTrend = (curr: number, prev: number) => prev === 0 ? 0 : parseFloat((((curr - prev) / prev) * 100).toFixed(1));

            trends.consultsTrendMoM = calcTrend(totalConsults, prevMoM.tConsults);
            trends.consultsTrendYoY = calcTrend(totalConsults, prevYoY.tConsults);
            trends.consultsDeltaMoM = totalConsults - prevMoM.tConsults;
            trends.consultsDeltaYoY = totalConsults - prevYoY.tConsults;

            trends.transfersTrendMoM = calcTrend(totalTransfers, prevMoM.tTransfers);
            trends.transfersTrendYoY = calcTrend(totalTransfers, prevYoY.tTransfers);
            trends.transfersDeltaMoM = totalTransfers - prevMoM.tTransfers;
            trends.transfersDeltaYoY = totalTransfers - prevYoY.tTransfers;

            trends.activeHospitalsTrendMoM = calcTrend(activeHospitals, prevMoM.aHospitals);
            trends.activeHospitalsTrendYoY = calcTrend(activeHospitals, prevYoY.aHospitals);
            trends.activeHospitalsDeltaMoM = activeHospitals - prevMoM.aHospitals;
            trends.activeHospitalsDeltaYoY = activeHospitals - prevYoY.aHospitals;

            const prevInactiveMoM = Math.max(0, totalHospitals - prevMoM.aHospitals);
            const prevInactiveYoY = Math.max(0, totalHospitals - prevYoY.aHospitals);

            trends.inactiveHospitalsTrendMoM = calcTrend(inactiveHospitals, prevInactiveMoM);
            trends.inactiveHospitalsTrendYoY = calcTrend(inactiveHospitals, prevInactiveYoY);
            trends.inactiveHospitalsDeltaMoM = inactiveHospitals - prevInactiveMoM;
            trends.inactiveHospitalsDeltaYoY = inactiveHospitals - prevInactiveYoY;
        }



        // Get Last Updated time (max modified_date) and Last Consult time (max created_date)
        const timestampQ = `
            SELECT 
                MAX(modified_date) as max_mod,
                MAX(created_date) as max_created
            FROM ${CONSULT_FACT_HOSPITAL_TABLE}
            WHERE corporate_profile = 'PetSmart'
              AND for_testing = false
              AND ${SQL_EXCLUDE_INTERNAL_HOSPITAL_CONSULTS}
        `;
        const tsRes = await client.query(timestampQ);
        const lastUpdated = tsRes.rows[0].max_mod;
        const lastConsult = tsRes.rows[0].max_created;

        res.json({
            totalConsults,
            totalHospitals,
            activeHospitals,
            inactiveHospitals,
            totalTransfers,
            petSmartConsultWarehouseTotal,
            lastUpdated, // Most recent modification
            lastConsult, // Most recent creation
            ...trends
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: String(err) });
    } finally {
        await client.end();
    }
});

router.get('/charts/volume', async (req, res) => {
    const client = await getClient();
    try {
        const where = buildWhereClause(req);
        // Daily volume if month selected, or Monthly volume if no month?
        // Default: Group by created_date::DATE
        const query = `
            SELECT created_date::DATE as date, COUNT(*) as count 
            FROM ${CONSULT_FACT_HOSPITAL_TABLE} 
            ${where.text} 
            GROUP BY created_date::DATE 
            ORDER BY date ASC
        `;
        const result = await client.query(query, where.values);
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: String(err) });
    } finally {
        await client.end();
    }
});

router.get('/filters/premium-tiers', async (_req, res) => {
    const client = await getClient();
    try {
        const result = await client.query<{ premium_tier: string }>(`
            SELECT DISTINCT premium_tier
            FROM ${CONSULT_FACT_HOSPITAL_TABLE}
            WHERE corporate_profile = 'PetSmart'
              AND for_testing = false
              AND ${SQL_EXCLUDE_INTERNAL_HOSPITAL_CONSULTS}
              AND premium_tier IS NOT NULL
              AND premium_tier <> ''
            ORDER BY premium_tier ASC
        `);
        res.json(result.rows.map((row) => row.premium_tier));
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: String(err) });
    } finally {
        await client.end();
    }
});

router.get('/filters/species', async (_req, res) => {
    const client = await getClient();
    try {
        const result = await client.query<{ species: string }>(`
            SELECT DISTINCT species
            FROM ${CONSULT_FACT_HOSPITAL_TABLE}
            WHERE corporate_profile = 'PetSmart'
              AND for_testing = false
              AND ${SQL_EXCLUDE_INTERNAL_HOSPITAL_CONSULTS}
              AND species IS NOT NULL
              AND species <> ''
            ORDER BY species ASC
        `);
        res.json(result.rows.map((row) => row.species));
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: String(err) });
    } finally {
        await client.end();
    }
});

router.get('/hospitals', async (req, res) => {
    const client = await getClient();
    try {
        const where = buildWhereClause(req);
        const query = `
            SELECT 
                MAX(hospital_code) as hospital_code,
                MAX(hospital_internal_name) as hospital_internal_name,
                MAX(province) as province,
                MAX(premium_tier) as premium_tier,
                COUNT(*) as volume,
                COUNT(CASE WHEN transferred = true THEN 1 END) as transfers
            FROM ${CONSULT_FACT_HOSPITAL_TABLE} 
            ${where.text} 
            GROUP BY ${hospitalEntityGroupExpr}
            ORDER BY COUNT(*) DESC
            LIMIT 10
        `;
        const result = await client.query(query, where.values);
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: String(err) });
    } finally {
        await client.end();
    }
});

router.get('/hospitals/trends', async (req, res) => {
    const client = await getClient();
    try {
        // Intentionally ignore date filters so utilization trends can be compared over full history.
        const where = buildWhereClause(req, { includeDate: false });
        const query = `
            SELECT
                MAX(hospital_code) as hospital_code,
                month_bucket,
                COUNT(*) as volume
            FROM ${CONSULT_FACT_HOSPITAL_TABLE}
            ${where.text}
              AND ${hospitalEntityGroupExpr} IS NOT NULL
              AND month_bucket IS NOT NULL
            GROUP BY ${hospitalEntityGroupExpr}, month_bucket
            ORDER BY month_bucket ASC, volume DESC
        `;

        const result = await client.query(query, where.values);
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: String(err) });
    } finally {
        await client.end();
    }
});

router.get('/hospitals/display', async (req, res) => {
    const client = await getClient();
    try {
        const codes = parseHospitalCodesQuery(req);
        if (codes.length === 0) {
            res.json([]);
            return;
        }
        const dw = buildHospitalDisplayWhereClause(req);
        const codeParam = dw.nextParamIdx;
        const query = `
            SELECT hospital_code, MAX(hospital_internal_name) AS hospital_internal_name
            FROM ${CONSULT_FACT_HOSPITAL_TABLE}
            ${dw.text} AND hospital_code = ANY($${codeParam}::text[])
            GROUP BY hospital_code
        `;
        const result = await client.query<{ hospital_code: string; hospital_internal_name: string | null }>(
            query,
            [...dw.values, codes]
        );
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: String(err) });
    } finally {
        await client.end();
    }
});

router.get('/unknown-hospitals/recent', async (_req, res) => {
    res.json({ rows: [], byReasonProvince: [] });
});

router.get('/species', async (req, res) => {
    const client = await getClient();
    try {
        const where = buildWhereClause(req);
        const query = `
            SELECT species, COUNT(*) as count 
            FROM ${CONSULT_FACT_HOSPITAL_TABLE} 
            ${where.text} 
            GROUP BY species 
            ORDER BY count DESC
        `;
        const result = await client.query(query, where.values);
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: String(err) });
    } finally {
        await client.end();
    }
});

router.get('/charts/wait-time/daily', async (req, res) => {
    const client = await getClient();
    try {
        const claimColumnMeta = await getClaimedTimestampColumn(client);
        const consultColumnMeta = await getConsultDateTimeColumn(client);
        if (!claimColumnMeta) {
            res.json([]);
            return;
        }

        const where = buildWhereClause(req);
        const waitMinutesExpr = getWaitMinutesExpression(claimColumnMeta, consultColumnMeta);
        const query = `
            WITH wait_rows AS (
                SELECT
                    created_date::DATE as created_day,
                    CASE
                        WHEN ${claimColumnMeta.columnName} IS NULL THEN NULL
                        ELSE ${waitMinutesExpr}
                    END as wait_minutes
                FROM ${CONSULT_FACT_HOSPITAL_TABLE}
                ${where.text}
            )
            SELECT
                created_day as date,
                AVG(wait_minutes) as avg_wait_minutes
            FROM wait_rows
            WHERE wait_minutes IS NOT NULL
              AND wait_minutes >= 0
            GROUP BY created_day
            ORDER BY date ASC
        `;
        const result = await client.query(query, where.values);
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: String(err) });
    } finally {
        await client.end();
    }
});

router.get('/charts/wait-time/species', async (req, res) => {
    const client = await getClient();
    try {
        const claimColumnMeta = await getClaimedTimestampColumn(client);
        const consultColumnMeta = await getConsultDateTimeColumn(client);
        if (!claimColumnMeta) {
            res.json([]);
            return;
        }

        const where = buildWhereClause(req);
        const waitMinutesExpr = getWaitMinutesExpression(claimColumnMeta, consultColumnMeta);
        const query = `
            WITH wait_rows AS (
                SELECT
                    species,
                    CASE
                        WHEN ${claimColumnMeta.columnName} IS NULL THEN NULL
                        ELSE ${waitMinutesExpr}
                    END as wait_minutes
                FROM ${CONSULT_FACT_HOSPITAL_TABLE}
                ${where.text}
            )
            SELECT
                species,
                AVG(wait_minutes) as avg_wait_minutes
            FROM wait_rows
            WHERE wait_minutes IS NOT NULL
              AND wait_minutes >= 0
              AND species IS NOT NULL
              AND species <> ''
            GROUP BY species
            ORDER BY avg_wait_minutes DESC
        `;
        const result = await client.query(query, where.values);
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: String(err) });
    } finally {
        await client.end();
    }
});

router.get('/charts/wait-time/province', async (req, res) => {
    const client = await getClient();
    try {
        const claimColumnMeta = await getClaimedTimestampColumn(client);
        const consultColumnMeta = await getConsultDateTimeColumn(client);
        if (!claimColumnMeta) {
            res.json([]);
            return;
        }

        const where = buildWhereClause(req);
        const waitMinutesExpr = getWaitMinutesExpression(claimColumnMeta, consultColumnMeta);
        const query = `
            WITH wait_rows AS (
                SELECT
                    province,
                    CASE
                        WHEN ${claimColumnMeta.columnName} IS NULL THEN NULL
                        ELSE ${waitMinutesExpr}
                    END as wait_minutes
                FROM ${CONSULT_FACT_HOSPITAL_TABLE}
                ${where.text}
            )
            SELECT
                province,
                AVG(wait_minutes) as avg_wait_minutes
            FROM wait_rows
            WHERE wait_minutes IS NOT NULL
              AND wait_minutes >= 0
              AND province IS NOT NULL
              AND province <> ''
            GROUP BY province
            ORDER BY avg_wait_minutes DESC
        `;
        const result = await client.query(query, where.values);
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: String(err) });
    } finally {
        await client.end();
    }
});

router.post('/sync/bubble', async (_req, res) => {
    if (process.env.DASHBOARD_BUBBLE_SYNC !== 'true') {
        console.log('[sync/bubble] skipped: DASHBOARD_BUBBLE_SYNC is not enabled');
        res.json({ skipped: true, reason: 'DASHBOARD_BUBBLE_SYNC is not enabled' });
        return;
    }

    const token = process.env.BUBBLE_API_TOKEN;
    const dbUrl = process.env.DATABASE_URL;

    if (!token || !dbUrl) {
        console.error('[sync/bubble] missing BUBBLE_API_TOKEN or DATABASE_URL');
        res.status(500).json({ error: 'Missing server configuration' });
        return;
    }

    const configuredPerPass = Number(process.env.DASHBOARD_SYNC_MAX_DURATION_MS ?? '90000');
    const perPassMs = Number.isFinite(configuredPerPass) ? Math.max(5000, configuredPerPass) : 90000;
    const configuredMaxPasses = Number(process.env.DASHBOARD_SYNC_MAX_PASSES ?? '15');
    const maxPasses = Number.isFinite(configuredMaxPasses) ? Math.min(30, Math.max(1, configuredMaxPasses)) : 15;

    console.log(
        `[sync/bubble] starting runIngestionPasses at ${new Date().toISOString()} perPassMs=${perPassMs} maxPasses=${maxPasses}`
    );

    try {
        const summary = await runIngestionPasses(token, dbUrl, perPassMs, { maxPasses });
        console.log('[sync/bubble] complete', {
            totalProcessed: summary.totalProcessed,
            passes: summary.passes,
            remaining: summary.remaining,
            lastTimedOut: summary.lastTimedOut,
            nextCursor: summary.nextCursor,
            incrementalResume: summary.incrementalResume
        });
        res.json({ skipped: false, ...summary });
    } catch (err) {
        console.error('[sync/bubble] failed', err);
        res.status(500).json({ error: String(err) });
    }
});

router.post('/ingest', async (req, res) => {
    const ingestApiKey = process.env.INGEST_API_KEY;
    if (ingestApiKey) {
        const requestToken = getIngestAuthToken(req);
        if (!requestToken || requestToken !== ingestApiKey) {
            res.status(401).json({ error: "Unauthorized" });
            return;
        }
    }

    const token = process.env.BUBBLE_API_TOKEN;
    const dbUrl = process.env.DATABASE_URL;

    if (!token || !dbUrl) {
        res.status(500).json({ error: "Missing server configuration" });
        return;
    }

    try {
        const fullSyncQuery = req.query.full;
        const forceFullSync = fullSyncQuery === '1' || fullSyncQuery === 'true';
        const configuredMaxDuration = Number(process.env.INGEST_MAX_DURATION_MS ?? '8000');

        const configuredFullMaxDuration = Number(process.env.INGEST_FULL_MAX_DURATION_MS ?? '24000');
        const fallbackDuration = forceFullSync ? 24000 : 8000;
        const chosenDuration = forceFullSync ? configuredFullMaxDuration : configuredMaxDuration;
        const maxDurationMs = Number.isFinite(chosenDuration) ? chosenDuration : fallbackDuration;
        const cursorQuery = req.query.cursor;
        const parsedCursor = typeof cursorQuery === 'string' ? Number(cursorQuery) : NaN;
        const hasCursor = Number.isFinite(parsedCursor) && parsedCursor >= 0;
        const cursorValue = hasCursor ? Math.floor(parsedCursor) : 0;
        const phaseRaw = typeof req.query.incremental_phase === 'string' ? req.query.incremental_phase.toLowerCase() : '';
        const incrementalExplicit =
            req.query.incremental_resume === '1' ||
            req.query.incremental_resume === 'true' ||
            phaseRaw === 'modified' ||
            phaseRaw === 'created';
        const incrementalPhase = phaseRaw === 'created' ? 'created' : 'modified';
        const incrementalResume =
            hasCursor && incrementalExplicit
                ? { phase: incrementalPhase as 'created' | 'modified', cursor: cursorValue }
                : undefined;
        const result = await runIngestion(token, dbUrl, maxDurationMs, {
            forceFullSync,
            startCursor: incrementalResume ? 0 : cursorValue,
            incrementalResume
        });
        res.json({ message: "Ingestion complete", ...result });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: String(err) });
    }
});

router.get('/consultations', async (req, res) => {
    const client = await getClient();
    try {
        const where = buildWhereClause(req);
        // Limit 100 for safety
        const query = `
            SELECT *
            FROM ${CONSULT_FACT_HOSPITAL_TABLE} 
            ${where.text} 
            ORDER BY created_date DESC
            LIMIT 100
        `;
        const result = await client.query(query, where.values);
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: String(err) });
    } finally {
        await client.end();
    }
});

app.use('/api', router);

export { app };
export default serverless(app);
