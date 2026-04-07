import type { IncomingMessage, ServerResponse } from 'node:http';

export default function ping(_req: IncomingMessage, res: ServerResponse) {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ ok: true, route: 'ping' }));
}
