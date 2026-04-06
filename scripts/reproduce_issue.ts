import axios from 'axios';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const bubbleApiBaseUrl = (process.env.BUBBLE_API_BASE_URL ?? 'https://app.getvetwise.com/api/1.1').replace(/\/+$/, '');
const bubbleObjectsUrl = `${bubbleApiBaseUrl}/obj`;

// --- Types ---
const parseRegion = (region: string | undefined): { country: string; province: string } => {
    if (!region) return { country: 'Unknown', province: 'Unknown' };
    const parts = region.split(/[,-]+/).map(s => s.trim());
    if (parts.length >= 2) {
        return { country: parts[1], province: parts[0] }; // Fixed: [1] is Country, [0] is Province
    }
    return { country: 'Unknown', province: region };
};

const fetchAllPages = async (token: string, objectName: string, constraints: any[] = []): Promise<any[]> => {
    let allResults: any[] = [];
    let cursor = 0;
    let remaining = 1;

    console.log(`Caching reference table: ${objectName}...`);

    while (remaining > 0) {
        try {
            const response = await axios.get(`${bubbleObjectsUrl}/${objectName}`, {
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
            console.log(`   Fetched ${data.count} items...`);
        } catch (err: any) {
            console.error(`   Failed to fetch ${objectName}:`, err.message);
            break;
        }
    }
    console.log(`Cached ${allResults.length} records for ${objectName}.`);
    return allResults;
};

const run = async () => {
    const bubbleToken = process.argv[2];
    if (!bubbleToken) { console.error("No token!"); process.exit(1); }

    // 1. Build Lookup Maps
    const regionsRaw = await fetchAllPages(bubbleToken, "ServiceRegionOffering");
    const regionMap = new Map<string, string>();
    regionsRaw.forEach((r: any) => {
        if (r.Region) regionMap.set(r._id, r.Region);
    });
    console.log(`Region Map Size: ${regionMap.size}`);

    // Lazy Load Setup
    const clientCache = new Map<string, string>();
    const userCache = new Map<string, string>();

    const resolveStoreName = async (clientId: string, userProfileFallback: string): Promise<string> => {
        let targetUserId = userProfileFallback;

        if (clientId) {
            if (clientCache.has(clientId)) {
                targetUserId = clientCache.get(clientId)!;
            } else {
                try {
                    const res = await axios.get(`${bubbleObjectsUrl}/Client/${clientId}`, {
                        headers: { Authorization: `Bearer ${bubbleToken}` }
                    });
                    const uProfile = res.data.response["User Profile"];
                    if (uProfile) {
                        clientCache.set(clientId, uProfile);
                        targetUserId = uProfile;
                    }
                } catch (e: any) {
                    console.log(`   [Client Lookup Failed] ${e.message}`);
                }
            }
        }

        if (!targetUserId) return "Unknown Store (No User ID)";

        if (userCache.has(targetUserId)) {
            return userCache.get(targetUserId)!;
        }

        try {
            const res = await axios.get(`${bubbleObjectsUrl}/User/${targetUserId}`, {
                headers: { Authorization: `Bearer ${bubbleToken}` }
            });
            const u = res.data.response;
            const name = u["User's Last Name"] || u["Last Name"] || u.Name || "Unknown Store (No Name)";
            userCache.set(targetUserId, name);
            return name;
        } catch (e: any) {
            console.log(`   [User Lookup Failed] ${e.message}`);
            return "Unknown Store (Lookup Error)";
        }
    };

    // 2. Fetch Sample Consults (mimic production)
    const constraints: any[] = [
        { key: "Corporate Profile", constraint_type: "equals", value: "1689294643974x246117167647534200" },
        { key: "Tracking Status", constraint_type: "equals", value: "Complete" },
        { key: "Cancelled at", constraint_type: "is_empty" }
    ];

    console.log("Fetching sample consults...");
    const res = await axios.get(`${bubbleObjectsUrl}/Consultation`, {
        params: { constraints: JSON.stringify(constraints), limit: 5 },
        headers: { Authorization: `Bearer ${bubbleToken}` }
    });
    const results = res.data.response.results;

    for (const item of results) {
        console.log(`\n--- Consult: ${item._id} ---`);

        // Region
        const regionId = item["Service Region Offering"];
        const regionStr = regionMap.get(regionId);
        console.log(`   Region ID: ${regionId}`);
        console.log(`   Region Found: ${regionStr}`);
        const regionObj = parseRegion(regionStr || regionId);
        console.log(`   Parsed: Region=${regionObj.province}, Country=${regionObj.country}`);

        // Store
        const clientId = item["Client"];
        const fallbackIds = item["User Profile"];
        console.log(`   Client ID: ${clientId}`);
        const storeName = await resolveStoreName(clientId, fallbackIds);
        console.log(`   Resolved Store: ${storeName}`);
    }
};

run();
