import { app } from '../api/index.js';

const port = Number(process.env.API_DEV_PORT ?? '3001');
if (!Number.isFinite(port) || port <= 0) {
    console.error('[dev-api] Invalid API_DEV_PORT');
    process.exit(1);
}

app.listen(port, '127.0.0.1', () => {
    console.log(`[dev-api] listening on http://127.0.0.1:${port} (proxy /api from Vite)`);
});
