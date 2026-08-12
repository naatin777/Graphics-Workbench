import type { JSX } from 'solid-js';

export interface ToolbarButtonProps {
  icon: string;
  label: string;
  disabled?: boolean;
  onClick?: () => void;
  className?: string;
  draggable?: boolean;
  onDragStart?: (event: DragEvent) => void;
  onDragEnd?: () => void;
}

/**
 * VS Code action-bar style icon button. 24px outer, 16px Codicon inner.
 * `icon` is a codicon class such as `codicon-zoom-out`.
 */
export function ToolbarButton(props: ToolbarButtonProps): JSX.Element {
  const classes = (): string => {
    const parts = ['gw-toolbar-button'];
    if (props.className) {
      parts.push(props.className);
    }
    return parts.join(' ');
  };

  return (
    <button
      type='button'
      class={classes()}
      aria-label={props.label}
      title={props.label}
      disabled={props.disabled}
      draggable={props.draggable}
      onClick={props.onClick}
      onDragStart={props.onDragStart}
      onDragEnd={props.onDragEnd}
    >
      <span
        class={`codicon ${props.icon}`}
        aria-hidden='true'
      />
    </button>
  );
}
