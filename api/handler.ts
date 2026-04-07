import type { IncomingMessage, ServerResponse } from 'node:http';
import { app } from './index.js';

type MutableRequest = IncomingMessage & { url?: string };

const normalizePath = (rawPath: string | string[] | undefined) => {
    if (Array.isArray(rawPath)) {
        return rawPath.join('/');
    }
    return rawPath ?? '';
};

export default async function handler(req: MutableRequest, res: ServerResponse) {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const forwardedPath = normalizePath(url.searchParams.getAll('path'));
    const nextPath = forwardedPath ? `/${forwardedPath}` : '/';
    url.searchParams.delete('path');
    const nextQuery = url.searchParams.toString();
    req.url = nextQuery ? `${nextPath}?${nextQuery}` : nextPath;

    return app(req, res);
}
