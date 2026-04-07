import { useEffect, useState } from 'react';
import axios from 'axios';
import { AlertTriangle, LoaderCircle, LockKeyhole, ShieldCheck } from 'lucide-react';
import { DashboardView } from './components/DashboardView';

interface LoginResponse {
    retryAfterSeconds?: number;
    error?: string;
    token?: string;
}

interface SessionResponse {
    authenticated: boolean;
}

const API_BASE = '/api';
const AUTH_TOKEN_STORAGE_KEY = 'ps_dashboard_auth_token';
const AUTH_REQUEST_TIMEOUT_MS = 12000;

const getStoredAuthToken = () => {
    if (typeof window === 'undefined') {
        return null;
    }

    return window.localStorage.getItem(AUTH_TOKEN_STORAGE_KEY);
};

const applyAuthToken = (token: string | null) => {
    if (token) {
        axios.defaults.headers.common.Authorization = `Bearer ${token}`;
        return;
    }

    delete axios.defaults.headers.common.Authorization;
};

const persistAuthToken = (token: string | null) => {
    if (typeof window !== 'undefined') {
        if (token) {
            window.localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, token);
        } else {
            window.localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
        }
    }

    applyAuthToken(token);
};

interface UnlockScreenProps {
    onUnlock: (password: string) => Promise<void>;
    loading: boolean;
    error: string | null;
    retryAfterSeconds: number;
}

const formatRetryAfter = (seconds: number) => {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    if (minutes <= 0) {
        return `${remainingSeconds}s`;
    }
    return `${minutes}m ${String(remainingSeconds).padStart(2, '0')}s`;
};

const UnlockScreen = ({ onUnlock, loading, error, retryAfterSeconds }: UnlockScreenProps) => {
    const [password, setPassword] = useState('');
    const locked = retryAfterSeconds > 0;

    const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (loading || locked) return;
        await onUnlock(password);
    };

    return (
        <div className="min-h-screen bg-brand-bg text-fg-primary flex items-center justify-center px-4 py-10 selection:bg-brand-accent/30">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(255,106,26,0.12),_transparent_40%),radial-gradient(circle_at_bottom_right,_rgba(37,99,235,0.08),_transparent_36%),radial-gradient(circle_at_20%_80%,_rgba(56,189,248,0.06),_transparent_32%)] pointer-events-none" />
            <div className="relative w-full max-w-md rounded-3xl border border-subtle bg-brand-card p-6 sm:p-8 shadow-xl backdrop-blur-xl">
                <div className="mb-7 flex items-start justify-between gap-4">
                    <div>
                        <div className="mb-4 inline-flex items-center justify-center rounded-2xl border border-subtle bg-brand-card-hover p-3 text-brand-accent">
                            <LockKeyhole className="h-6 w-6" />
                        </div>
                        <h1 className="text-2xl font-bold text-fg-primary tracking-tight">Hospital Analytics</h1>
                        <p className="mt-2 text-sm leading-5 text-fg-muted">Protected dashboard access.</p>
                    </div>
                    <div className="hidden sm:inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-semantic-success/25 bg-semantic-success/10 px-3 py-1 text-xs font-medium leading-none text-semantic-success">
                        <ShieldCheck className="h-3.5 w-3.5" />
                        Secure entry
                    </div>
                </div>

                <form className="space-y-4" onSubmit={handleSubmit}>
                    <div className="space-y-2">
                        <label htmlFor="dashboard-password" className="text-xs font-medium uppercase tracking-[0.2em] text-fg-muted">
                            Password
                        </label>
                        <input
                            id="dashboard-password"
                            type="password"
                            autoComplete="current-password"
                            className="w-full rounded-2xl border border-subtle bg-brand-card-hover px-4 py-3 text-fg-primary outline-none transition-dashboard placeholder:text-fg-muted focus:border-brand-accent/80 focus:ring-2 focus:ring-brand disabled:cursor-not-allowed disabled:opacity-60"
                            placeholder="Enter dashboard password"
                            value={password}
                            onChange={(event) => setPassword(event.target.value)}
                            disabled={loading || locked}
                        />
                    </div>

                    <button
                        type="submit"
                        disabled={loading || locked || password.trim().length === 0}
                        className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-brand-accent px-4 py-3 text-sm font-semibold text-white shadow-card transition-dashboard hover:bg-brand-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
                    >
                        {loading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <LockKeyhole className="h-4 w-4" />}
                        {loading ? 'Unlocking...' : 'Unlock dashboard'}
                    </button>
                </form>

                {(error || locked) && (
                    <div className="mt-4 rounded-2xl border border-semantic-danger/25 bg-semantic-danger/10 px-4 py-3 text-sm text-fg-primary">
                        <div className="flex items-start gap-2">
                            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-semantic-danger" />
                            <div>
                                <p>{error ?? 'Unable to unlock dashboard.'}</p>
                                {locked && (
                                    <p className="mt-1 text-fg-secondary">
                                        Too many failed attempts. Try again in {formatRetryAfter(retryAfterSeconds)}.
                                    </p>
                                )}
                            </div>
                        </div>
                    </div>
                )}

                <p className="mt-5 text-xs leading-5 text-fg-muted">
                    Access attempts are rate limited and blocked after repeated failures.
                </p>
            </div>
        </div>
    );
};

const CheckingScreen = () => (
    <div className="min-h-screen bg-brand-bg text-fg-primary flex items-center justify-center px-4">
        <div className="rounded-3xl border border-subtle bg-brand-card px-6 py-5 shadow-xl backdrop-blur-xl">
            <div className="flex items-center gap-3 text-fg-secondary">
                <LoaderCircle className="h-5 w-5 animate-spin text-brand-accent" />
                <span className="text-sm font-medium">Checking access...</span>
            </div>
        </div>
    </div>
);

function App() {
    const [checkingSession, setCheckingSession] = useState(true);
    const [authenticated, setAuthenticated] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [retryAfterSeconds, setRetryAfterSeconds] = useState(0);
    const [authToken, setAuthToken] = useState<string | null>(() => getStoredAuthToken());

    useEffect(() => {
        let cancelled = false;
        applyAuthToken(authToken);
        const stuckGuard = window.setTimeout(() => {
            if (!cancelled) {
                setCheckingSession(false);
            }
        }, AUTH_REQUEST_TIMEOUT_MS + 3000);

        const checkSession = async () => {
            try {
                const response = await axios.get<SessionResponse>(`${API_BASE}/auth/session`, {
                    validateStatus: () => true,
                    timeout: AUTH_REQUEST_TIMEOUT_MS
                });

                if (cancelled) return;

                const isAuthenticated = response.status === 200 && response.data?.authenticated === true;
                setAuthenticated(isAuthenticated);
                if (!isAuthenticated) {
                    setAuthToken(null);
                    persistAuthToken(null);
                }
            } catch {
                if (!cancelled) {
                    setAuthenticated(false);
                    setAuthToken(null);
                    persistAuthToken(null);
                }
            } finally {
                if (!cancelled) {
                    setCheckingSession(false);
                }
            }
        };

        void checkSession();

        return () => {
            cancelled = true;
            window.clearTimeout(stuckGuard);
        };
    }, [authToken]);

    useEffect(() => {
        if (retryAfterSeconds <= 0) {
            return;
        }

        const timer = window.setInterval(() => {
            setRetryAfterSeconds((current) => (current > 1 ? current - 1 : 0));
        }, 1000);

        return () => window.clearInterval(timer);
    }, [retryAfterSeconds]);

    const handleUnlock = async (password: string) => {
        setSubmitting(true);
        setError(null);

        try {
            const response = await axios.post<LoginResponse>(
                `${API_BASE}/auth/login`,
                { password },
                {
                    validateStatus: () => true,
                    timeout: AUTH_REQUEST_TIMEOUT_MS
                }
            );

            if (response.status === 200) {
                const nextToken = response.data?.token ?? null;
                if (!nextToken) {
                    setError('Login succeeded, but no access token was returned. Please try again.');
                    return;
                }

                setAuthToken(nextToken);
                persistAuthToken(nextToken);

                const sessionResponse = await axios.get<SessionResponse>(`${API_BASE}/auth/session`, {
                    validateStatus: () => true,
                    timeout: AUTH_REQUEST_TIMEOUT_MS
                });

                if (sessionResponse.status === 200 && sessionResponse.data?.authenticated === true) {
                    setAuthenticated(true);
                    setRetryAfterSeconds(0);
                    return;
                }

                setAuthToken(null);
                persistAuthToken(null);
                setError('Login succeeded, but the secure session was not established. Please try again.');
                return;
            }

            if (response.status === 429) {
                const retryAfter = response.data?.retryAfterSeconds ?? 0;
                setRetryAfterSeconds(retryAfter);
                setError(response.data?.error ?? 'Too many failed attempts.');
                return;
            }

            setError(response.data?.error ?? 'Incorrect password.');
        } catch {
            setError('Unable to verify password right now.');
        } finally {
            setSubmitting(false);
        }
    };

    if (checkingSession) {
        return <CheckingScreen />;
    }

    if (!authenticated) {
        return (
            <UnlockScreen
                onUnlock={handleUnlock}
                loading={submitting}
                error={error}
                retryAfterSeconds={retryAfterSeconds}
            />
        );
    }

    return <DashboardView />;
}

export default App;
