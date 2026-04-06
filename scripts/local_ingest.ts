import { runIngestion } from '../server/lib/ingestion';

const run = async () => {
    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) {
        console.error("Error: Please provide DATABASE_URL environment variable.");
        console.error("Usage: DATABASE_URL=... npx tsx scripts/local_ingest.ts");
        process.exit(1);
    }

    const BUBBLE_TOKEN = process.env.BUBBLE_API_TOKEN;
    if (!BUBBLE_TOKEN) {
        console.error("Error: Please provide BUBBLE_API_TOKEN environment variable.");
        process.exit(1);
    }

    // Run with 1-hour timeout to ensure full sync completes
    const ONE_HOUR_MS = 60 * 60 * 1000;

    console.log("--- STARTING LOCAL DATA POPULATION ---");
    console.log("This will re-process ALL records to fix names/regions.");
    console.log("Please wait, this may take a few minutes...");

    try {
        const result = await runIngestion(BUBBLE_TOKEN, dbUrl, ONE_HOUR_MS);
        console.log("\n--- SUCCESS! ---");
        console.log(`Processed: ${result.processed} records.`);
    } catch (e: any) {
        console.error("\n--- FAILED ---");
        console.error(e);
    }
};

run();
