import { useEffect } from 'react';
import { useStdout } from 'ink';
import ansiEscapes from 'ansi-escapes';

/**
 * Hide terminal cursor on component mount.
 *
 * This hook is used to prevent cursor flickering during page transitions.
 * Cursor visibility is restored by cli.tsx cleanup functions on application exit.
 *
 * @example
 * ```tsx
 * function MyScreen() {
 *   useCursorHide();
 *   return <Box>...</Box>;
 * }
 * ```
 */
export function useCursorHide(): void {
    const { stdout } = useStdout();

    useEffect(() => {
        stdout.write(ansiEscapes.cursorHide);
    }, [stdout]);
}
