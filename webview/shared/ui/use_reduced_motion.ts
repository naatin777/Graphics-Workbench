import { createSignal, onCleanup, onMount } from 'solid-js';

const reducedMotionQuery = '(prefers-reduced-motion: reduce)';

/** Reactive wrapper around prefers-reduced-motion. */
export function useReducedMotion(): () => boolean {
  const [reduced, setReduced] = createSignal(
    typeof globalThis.matchMedia === 'function' && globalThis.matchMedia(reducedMotionQuery).matches,
  );

  onMount(() => {
    if (typeof globalThis.matchMedia !== 'function') {
      return;
    }

    const mediaQuery = globalThis.matchMedia(reducedMotionQuery);
    const onChange = (event: MediaQueryListEvent): void => {
      setReduced(event.matches);
    };
    mediaQuery.addEventListener('change', onChange);
    onCleanup(() => {
      mediaQuery.removeEventListener('change', onChange);
    });
  });

  return reduced;
}
