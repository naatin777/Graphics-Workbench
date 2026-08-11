import { Show, createSignal, onCleanup, onMount, type JSX } from 'solid-js';

import { renderFirstPdfPage } from '@webview-shared/pdf/render_pdf_pages';
import { toErrorMessage } from '@webview-shared/error';

import type { ExtensionToWebviewMessage, MergePdfLabels, MergePdfSource } from './messages';
import { vscode } from './vscode';

export type PdfOptions = Pick<Extract<ExtensionToWebviewMessage, { type: 'init' }>['payload'], 'preview' | 'resources'>;

export function PreviewThumbnail(props: {
  source: MergePdfSource;
  options: PdfOptions;
  labels: MergePdfLabels;
  onError: () => void;
}): JSX.Element {
  const [status, setStatus] = createSignal<'waiting' | 'loading' | 'ready' | 'error'>('waiting');
  let canvas: HTMLCanvasElement | undefined;
  let frame: HTMLDivElement | undefined;

  onMount(() => {
    let started = false;
    const abortController = new AbortController();

    const renderPreview = async (): Promise<void> => {
      if (started || !canvas) {
        return;
      }

      started = true;
      setStatus('loading');

      try {
        await renderFirstPdfPage(props.source.pdfSrc, canvas, {
          ...props.options,
          signal: abortController.signal,
        });
        setStatus('ready');
      } catch (error) {
        if (abortController.signal.aborted) {
          return;
        }
        const message = toErrorMessage(error);
        setStatus('error');
        props.onError();
        vscode.sendMessage({ type: 'previewLoadFailed', payload: { message } });
      }
    };

    const observer =
      typeof IntersectionObserver === 'undefined'
        ? undefined
        : new IntersectionObserver(
            (entries) => {
              if (entries.some((entry) => entry.isIntersecting)) {
                observer?.disconnect();
                void renderPreview();
              }
            },
            { rootMargin: '120px' },
          );

    onCleanup(() => {
      abortController.abort();
      observer?.disconnect();
    });

    if (observer === undefined || frame === undefined) {
      void renderPreview();
      return;
    }

    observer.observe(frame);
  });

  return (
    <div
      ref={(element) => {
        frame = element;
      }}
      class='thumbnail'
      aria-label={`${props.labels.preview.ariaLabel}: ${props.source.fileName}`}
      aria-busy={status() === 'loading'}
    >
      <canvas
        ref={(element) => {
          canvas = element;
        }}
        class='thumbnail__canvas'
        aria-label={`${props.labels.preview.title}: ${props.source.fileName}`}
      />
      <Show when={status() === 'waiting' || status() === 'loading'}>
        <span class='thumbnail__status'>{props.labels.preview.loading}</span>
      </Show>
      <Show when={status() === 'error'}>
        <span
          class='thumbnail__status thumbnail__status--error'
          role='img'
          aria-label={props.labels.preview.renderError}
        >
          {props.labels.preview.renderError}
        </span>
      </Show>
    </div>
  );
}
