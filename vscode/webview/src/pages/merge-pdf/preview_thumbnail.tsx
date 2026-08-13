import { Show, createSignal, onCleanup, onMount, type JSX } from 'solid-js';

import type {
  MergePdfHostToWebview,
  MergePdfSource,
  MergePdfWebviewToHost,
} from '@graphics-workbench/vscode-protocol/merge-pdf-protocol';
import type { PageProtocolClient } from '@webview-shared/vscode';
import type { MessageReader } from '@webview-shared/messages';
import { renderFirstPdfPage } from '@webview-shared/pdf/render_pdf_pages';
import { toErrorMessage } from '@webview-shared/error';

export type PdfOptions = Pick<Extract<MergePdfHostToWebview, { type: 'init' }>['payload'], 'preview' | 'resources'>;
export type MergeThumbnailChannel = PageProtocolClient<MergePdfWebviewToHost, MergePdfHostToWebview>;

export function PreviewThumbnail(props: {
  source: MergePdfSource;
  options: PdfOptions;
  t: MessageReader;
  channel: MergeThumbnailChannel;
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
        props.channel.send.previewLoadFailed({ message });
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
      aria-label={`${props.t('webview.mergePdf.previewAriaLabel')}: ${props.source.fileName}`}
      aria-busy={status() === 'loading'}
    >
      <canvas
        ref={(element) => {
          canvas = element;
        }}
        class='thumbnail__canvas'
        aria-label={`${props.t('webview.mergePdf.preview')}: ${props.source.fileName}`}
      />
      <Show when={status() === 'waiting' || status() === 'loading'}>
        <span class='thumbnail__status'>{props.t('webview.mergePdf.previewLoading')}</span>
      </Show>
      <Show when={status() === 'error'}>
        <span
          class='thumbnail__status thumbnail__status--error'
          role='img'
          aria-label={props.t('webview.mergePdf.previewRenderError')}
        >
          {props.t('webview.mergePdf.previewRenderError')}
        </span>
      </Show>
    </div>
  );
}
