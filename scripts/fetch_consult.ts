
import axios from 'axios';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const run = async () => {
    const token = process.argv[2];
    if (!token) {
        console.error("Please provide the Bubble API Token as an argument.");
        console.error("Usage: npx tsx scripts/fetch_consult.ts <YOUR_API_TOKEN>");
        process.exit(1);
    }

    const bubbleApiBaseUrl = (process.env.BUBBLE_API_BASE_URL ?? 'https://app.getvetwise.com/api/1.1').replace(/\/+$/, '');
    const BUBBLE_API_URL = `${bubbleApiBaseUrl}/obj/Consultation`;
    const PETSMART_ID = "1719324470832x827090233000028000";

    const constraints = [
        { key: "Corporate Profile", constraint_type: "equals", value: PETSMART_ID }
    ];

    console.log("Fetching 1 PetSmart consult...");

    try {
        const response = await axios.get(BUBBLE_API_URL, {
            params: {
                constraints: JSON.stringify(constraints),
                limit: 1
            },
            headers: {
                Authorization: `Bearer ${token}`
            }
        });

        const results = response.data.response.results;

        if (results.length === 0) {
            console.log("No PetSmart consults found.");
        } else {
            console.log("--- RAW CONSULT DATA ---");
            console.log(JSON.stringify(results[0], null, 2));
            console.log("\n--- FIELDS TO INSPECT ---");
            console.log("Tracking Status:", results[0]["Tracking Status"]);
            console.log("Cancelled at:", results[0]["Cancelled at"]);
        }

    } catch (err: any) {
        console.error("Error fetching data:", err.response?.data || err.message);
    }
};

run();
