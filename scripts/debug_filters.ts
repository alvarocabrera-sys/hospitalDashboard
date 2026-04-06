import axios from 'axios';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const run = async () => {
    const token = process.argv[2];
    if (!token) {
        console.error("Please provide the Bubble API Token as an argument.");
        console.error("Usage: npx tsx scripts/debug_filters.ts <YOUR_API_TOKEN>");
        process.exit(1);
    }

    const bubbleApiBaseUrl = (process.env.BUBBLE_API_BASE_URL ?? 'https://app.getvetwise.com/api/1.1').replace(/\/+$/, '');
    const BUBBLE_API_URL = `${bubbleApiBaseUrl}/obj/Consultation`;
    // Correct Profile ID
    const PETSMART_ID = "1689294643974x246117167647534200";

    console.log("--- DIAGNOSTIC START ---");
    console.log("Target Corporate Profile:", PETSMART_ID);

    // Test 1: Only Corporate Profile
    console.log("\n1. Testing constraint: Corporate Profile ONLY...");
    try {
        const c1 = [
            { key: "Corporate Profile", constraint_type: "equals", value: PETSMART_ID }
        ];
        const r1 = await axios.get(BUBBLE_API_URL, {
            params: { constraints: JSON.stringify(c1), limit: 1 },
            headers: { Authorization: `Bearer ${token}` }
        });
        console.log(`   -> Found: ${r1.data.response.count} records (Remaining: ${r1.data.response.remaining})`);
    } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        console.error("   -> Error:", message);
    }

    // Test 2: Corp Profile + Tracking Status = Complete
    console.log("\n2. Testing constraint: + Tracking Status = 'Complete'...");
    try {
        const c2 = [
            { key: "Corporate Profile", constraint_type: "equals", value: PETSMART_ID },
            { key: "Tracking Status", constraint_type: "equals", value: "Complete" }
        ];
        const r2 = await axios.get(BUBBLE_API_URL, {
            params: { constraints: JSON.stringify(c2), limit: 1 },
            headers: { Authorization: `Bearer ${token}` }
        });
        console.log(`   -> Found: ${r2.data.response.count} records (Remaining: ${r2.data.response.remaining})`);
    } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        console.error("   -> Error:", message);
    }

    // Test 3: Corp Profile + Tracking + Cancelled is Empty
    console.log("\n3. Testing constraint: + Cancelled at is_empty (FULL FILTER)...");
    try {
        const c3 = [
            { key: "Corporate Profile", constraint_type: "equals", value: PETSMART_ID },
            { key: "Tracking Status", constraint_type: "equals", value: "Complete" },
            { key: "Cancelled at", constraint_type: "is_empty" }
        ];
        const r3 = await axios.get(BUBBLE_API_URL, {
            params: { constraints: JSON.stringify(c3), limit: 1 },
            headers: { Authorization: `Bearer ${token}` }
        });
        console.log(`   -> Found: ${r3.data.response.count} records (Remaining: ${r3.data.response.remaining})`);
    } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        console.error("   -> Error:", message);
    }

    console.log("\n--- DIAGNOSTIC COMPLETE ---");
};

run();
