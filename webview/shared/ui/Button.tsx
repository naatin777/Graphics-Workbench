import type { JSX } from 'solid-js';

export interface ButtonProps {
  children: JSX.Element;
  variant?: 'primary' | 'secondary';
  small?: boolean;
  type?: 'button' | 'submit';
  disabled?: boolean;
  onClick?: () => void;
  className?: string;
}

/**
 * VS Code-style text button. Primary for the main action, secondary for
 * Cancel / auxiliary actions.
 */
export function Button(props: ButtonProps): JSX.Element {
  const classes = (): string => {
    const parts = ['gw-button'];
    if (props.variant === 'primary') {
      parts.push('gw-button--primary');
    } else if (props.variant === 'secondary') {
      parts.push('gw-button--secondary');
    }
    if (props.small) {
      parts.push('gw-button--small');
    }
    if (props.className) {
      parts.push(props.className);
    }
    return parts.join(' ');
  };

  return (
    <button
      type={props.type ?? 'button'}
      class={classes()}
      disabled={props.disabled}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  );
}
