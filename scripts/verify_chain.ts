import axios from 'axios';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const run = async () => {
    const token = process.argv[2];
    if (!token) {
        console.error("Please provide API Token");
        process.exit(1);
    }

    const bubbleApiBaseUrl = (process.env.BUBBLE_API_BASE_URL ?? 'https://app.getvetwise.com/api/1.1').replace(/\/+$/, '');
    const BUBBLE_API_URL = `${bubbleApiBaseUrl}/obj`;
    const PETSMART_ID = "1689294643974x246117167647534200";

    console.log("--- CHAIN VERIFICATION START ---");

    // 1. Fetch 1 Complete Consult
    const constraints = [
        { key: "Corporate Profile", constraint_type: "equals", value: PETSMART_ID },
        { key: "Tracking Status", constraint_type: "equals", value: "Complete" },
        { key: "Cancelled at", constraint_type: "is_empty" }
    ];

    try {
        console.log("1. Fetching Consult...");
        const res = await axios.get(`${BUBBLE_API_URL}/Consultation`, {
            params: { constraints: JSON.stringify(constraints), limit: 1 },
            headers: { Authorization: `Bearer ${token}` }
        });
        const consult = res.data.response.results[0];
        if (!consult) { console.error("No consult found!"); return; }

        console.log(`   -> Consult ID: ${consult._id}`);
        console.log(`   -> 'Client' field: ${consult.Client}`);
        console.log(`   -> 'Service Region Offering' field: ${consult["Service Region Offering"]}`);

        // 2. Verify Region
        if (consult["Service Region Offering"]) {
            console.log("\n2. Fetching Region...");
            try {
                const rRes = await axios.get(`${BUBBLE_API_URL}/ServiceRegionOffering/${consult["Service Region Offering"]}`, {
                    headers: { Authorization: `Bearer ${token}` }
                });
                console.log(`   -> Region Object:`, rRes.data.response);
                console.log(`   -> Region Name: ${rRes.data.response.Region}`);
            } catch (e: any) { console.error("   -> Failed to fetch region:", e.message); }
        }

        // 3. Verify Client -> User -> Store Name
        if (consult.Client) {
            console.log("\n3. Fetching Client...");
            const cRes = await axios.get(`${BUBBLE_API_URL}/Client/${consult.Client}`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            const client = cRes.data.response;
            console.log(`   -> Client Object Found.`);
            console.log(`   -> 'User Profile' field: ${client["User Profile"]}`);

            if (client["User Profile"]) {
                console.log("\n4. Fetching User (Store)...");
                const uRes = await axios.get(`${BUBBLE_API_URL}/User/${client["User Profile"]}`, {
                    headers: { Authorization: `Bearer ${token}` }
                });
                const user = uRes.data.response;
                console.log(`   -> User Object Found.`);
                console.log(`   -> 'User's Last Name': ${user["User's Last Name"]}`);
                console.log(`   -> 'Last Name': ${user["Last Name"]}`);
                console.log(`   -> 'Name': ${user.Name}`);
            } else {
                console.log("   -> Client has no 'User Profile' field or it is empty.");
            }
        } else {
            console.log("   -> Consult has no 'Client' field.");
        }

    } catch (e: any) {
        console.error("Error:", e.message);
    }
    console.log("\n--- CHAIN VERIFICATION COMPLETE ---");
};

run();
