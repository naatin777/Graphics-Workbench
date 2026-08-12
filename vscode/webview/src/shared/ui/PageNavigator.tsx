import type { JSX } from 'solid-js';

import { useReducedMotion } from './use_reduced_motion';

export interface PageNavigatorProps {
  currentPage: number;
  pageCount: number;
  onPrevious: () => void;
  onNext: () => void;
  previousLabel?: string;
  nextLabel?: string;
}

/**
 * Compact page position control: `‹  2 / 10  ›`.
 *
 * The position label stays `2 / 10` for sighted users and carries a fuller
 * description only for assistive technology.
 */
export function PageNavigator(props: PageNavigatorProps): JSX.Element {
  const previousLabel = (): string => props.previousLabel ?? 'Previous page';
  const nextLabel = (): string => props.nextLabel ?? 'Next page';
  const canGoPrevious = (): boolean => props.currentPage > 1 && props.pageCount > 1;
  const canGoNext = (): boolean => props.currentPage < props.pageCount;

  const goPrevious = (): void => {
    if (canGoPrevious()) {
      props.onPrevious();
    }
  };

  const goNext = (): void => {
    if (canGoNext()) {
      props.onNext();
    }
  };

  return (
    <nav
      class='page-navigator'
      aria-label='Page navigation'
    >
      <button
        type='button'
        class='gw-toolbar-button'
        aria-label={previousLabel()}
        title={previousLabel()}
        disabled={!canGoPrevious()}
        onClick={goPrevious}
      >
        <span
          class='codicon codicon-chevron-left'
          aria-hidden='true'
        />
      </button>
      <span
        class='page-navigator__position'
        aria-label={`Page ${props.currentPage} of ${props.pageCount}`}
      >
        {props.currentPage} / {props.pageCount}
      </span>
      <button
        type='button'
        class='gw-toolbar-button'
        aria-label={nextLabel()}
        title={nextLabel()}
        disabled={!canGoNext()}
        onClick={goNext}
      >
        <span
          class='codicon codicon-chevron-right'
          aria-hidden='true'
        />
      </button>
    </nav>
  );
}

/**
 * Smooth-scrolls a page element into the center of the preview viewport,
 * honoring prefers-reduced-motion.
 */
export function scrollPageIntoView(pageElement: HTMLElement): void {
  pageElement.scrollIntoView({
    behavior: useReducedMotion() ? 'auto' : 'smooth',
    block: 'center',
    inline: 'nearest',
  });
}
