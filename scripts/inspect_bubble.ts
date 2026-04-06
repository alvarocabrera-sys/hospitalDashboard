
import axios from 'axios';
import dotenv from 'dotenv';
import path from 'path';

// Load .env
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const bubbleApiBaseUrl = (process.env.BUBBLE_API_BASE_URL ?? 'https://app.getvetwise.com/api/1.1').replace(/\/+$/, '');
const BUBBLE_API_URL = `${bubbleApiBaseUrl}/obj/Consultation`;
const TOKEN = process.env.BUBBLE_API_TOKEN;

const run = async () => {
    if (!TOKEN) {
        console.error("Missing BUBBLE_API_TOKEN in .env");
        process.exit(1);
    }

    console.log("Fetching 1 record from Bubble...");
    try {
        const response = await axios.get(BUBBLE_API_URL, {
            params: {
                limit: 1
            },
            headers: {
                Authorization: `Bearer ${TOKEN}`
            }
        });

        const results = response.data.response.results;
        if (results.length === 0) {
            console.log("No records found.");
        } else {
            console.log("--- RAW RECORD ---");
            console.log(JSON.stringify(results[0], null, 2));
        }
    } catch (err: any) {
        console.error("Error:", err.response?.data || err.message);
    }
};

run();
