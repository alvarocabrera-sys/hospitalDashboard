import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { Maximize2, Minimize2 } from 'lucide-react';

interface FullscreenFrameProps {
    children: React.ReactNode;
    className?: string;
}

const FullscreenFrameContext = createContext(false);

export const useFullscreenFrame = () => useContext(FullscreenFrameContext);

export const FullscreenFrame = ({ children, className = '' }: FullscreenFrameProps) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const [isFullscreen, setIsFullscreen] = useState(false);

    useEffect(() => {
        const handleFullscreenChange = () => {
            const activeElement = document.fullscreenElement;
            setIsFullscreen(activeElement === containerRef.current);
        };

        document.addEventListener('fullscreenchange', handleFullscreenChange);
        return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
    }, []);

    const toggleFullscreen = async () => {
        const element = containerRef.current;
        if (!element) {
            return;
        }

        if (document.fullscreenElement === element) {
            await document.exitFullscreen();
            return;
        }

        await element.requestFullscreen();
    };

    return (
        <div ref={containerRef} className={`relative w-full ${className}`.trim()}>
            <FullscreenFrameContext.Provider value={isFullscreen}>
                <button
                    type="button"
                    onClick={toggleFullscreen}
                    className="absolute top-3 right-3 z-20 inline-flex items-center justify-center rounded-md border border-subtle bg-brand-card/95 p-1.5 text-fg-secondary shadow-card backdrop-blur hover:text-fg-primary hover:border-brand-accent/50 transition-dashboard"
                    aria-label={isFullscreen ? 'Exit fullscreen' : 'View fullscreen'}
                    title={isFullscreen ? 'Exit fullscreen' : 'View fullscreen'}
                >
                    {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
                </button>
                {children}
            </FullscreenFrameContext.Provider>
        </div>
    );
};
