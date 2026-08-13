import type { JSX } from 'solid-js';

import type { MessageReader } from '@webview-shared/messages';

import type { PreviewMode } from './types';

export function PreviewToolbar(props: {
  t: MessageReader;
  previewMode: PreviewMode;
  zoomPercent: number;
  onPreviewModeChange: (mode: PreviewMode) => void;
  onZoomChange: (value: number) => void;
}): JSX.Element {
  return (
    <div class='pdf-preview__toolbar'>
      <div>
        <h2>{props.t('webview.splitPdf.preview')}</h2>
      </div>
      <div class='preview-tools'>
        <div
          aria-label={props.t('webview.splitPdf.preview')}
          class='segmented'
          role='group'
        >
          <button
            aria-pressed={props.previewMode === 'focused'}
            class='segmented__button'
            class:segmented__button--active={props.previewMode === 'focused'}
            type='button'
            onClick={() => {
              props.onPreviewModeChange('focused');
            }}
          >
            {props.t('webview.splitPdf.focusedPages')}
          </button>
          <button
            aria-pressed={props.previewMode === 'all'}
            class='segmented__button'
            class:segmented__button--active={props.previewMode === 'all'}
            type='button'
            onClick={() => {
              props.onPreviewModeChange('all');
            }}
          >
            {props.t('webview.splitPdf.allPages')}
          </button>
        </div>
        <label class='zoom'>
          <span class='sr-only'>{props.t('webview.splitPdf.zoom')}</span>
          <input
            aria-label={props.t('webview.splitPdf.zoom')}
            max='400'
            min='25'
            step='5'
            type='range'
            value={props.zoomPercent}
            onInput={(event) => {
              props.onZoomChange(Number(event.currentTarget.value));
            }}
          />
          <span class='zoom__number'>
            <input
              aria-label={props.t('webview.splitPdf.zoom')}
              max='400'
              min='25'
              step='5'
              type='number'
              value={props.zoomPercent}
              onInput={(event) => {
                props.onZoomChange(Number(event.currentTarget.value));
              }}
            />
            <span aria-hidden='true'>%</span>
          </span>
        </label>
      </div>
    </div>
  );
}
