import { createSignal, onCleanup, type JSX } from 'solid-js';

/**
 * Left/right resizable split pane.
 *
 * The divider can be dragged to resize the left pane. On small widths the
 * caller should stack the panes vertically via CSS media queries.
 */
export function SplitPane(props: { left: JSX.Element; right: JSX.Element }): JSX.Element {
  const [leftWidth, setLeftWidth] = createSignal<number | undefined>(undefined);
  const [isDragging, setIsDragging] = createSignal(false);
  let containerRef: HTMLDivElement | undefined;
  let stopDragging: (() => void) | undefined;

  onCleanup(() => {
    stopDragging?.();
  });

  const startDrag = (event: PointerEvent): void => {
    const container = containerRef;

    if (!container) {
      return;
    }

    event.preventDefault();
    setIsDragging(true);
    const containerRect = container.getBoundingClientRect();
    const minimumRightWidth = 240;
    const onPointerMove = (moveEvent: PointerEvent): void => {
      const width = moveEvent.clientX - containerRect.left;
      const maximumWidth = containerRect.width - minimumRightWidth - 6;
      setLeftWidth(Math.min(Math.max(width, 120), Math.max(maximumWidth, 120)));
    };
    const onPointerUp = (): void => {
      stopDragging = undefined;
      setIsDragging(false);
      globalThis.removeEventListener('pointermove', onPointerMove);
      globalThis.removeEventListener('pointerup', onPointerUp);
    };
    stopDragging = onPointerUp;
    globalThis.addEventListener('pointermove', onPointerMove);
    globalThis.addEventListener('pointerup', onPointerUp);
  };

  return (
    <div
      class='split-pane'
      ref={(element) => {
        containerRef = element;
      }}
    >
      <div
        class='split-pane__left'
        style={leftWidth() === undefined ? undefined : { flex: `0 0 ${leftWidth()}px` }}
      >
        {props.left}
      </div>
      <div
        class='split-pane__divider'
        role='separator'
        aria-orientation='vertical'
        data-active={isDragging()}
        onPointerDown={startDrag}
      />
      <div class='split-pane__right'>{props.right}</div>
    </div>
  );
}
