import { For, Show, createMemo, createSignal, onCleanup, onMount, type JSX } from 'solid-js';

import { mergePdfProtocol, type MergePdfSource } from '@graphics-workbench/vscode-protocol/merge-pdf-protocol';
import type { MessageCatalog } from '@graphics-workbench/vscode-protocol/typed-protocol';
import { createMessageReader } from '@webview-shared/messages';
import { Button } from '@webview-shared/ui/Button';
import { createPageProtocolClient, type WebviewHost } from '@webview-shared/vscode';
import { SplitPane } from '@webview-shared/SplitPane';

import { SourceCard } from './source_card';
import type { PdfOptions } from './preview_thumbnail';

export function App(properties: { host: WebviewHost }): JSX.Element {
  const channel = createPageProtocolClient(mergePdfProtocol, properties.host);
  const [sources, setSources] = createSignal<MergePdfSource[]>([]);
  const [pdfOptionsValue, setPdfOptions] = createSignal<PdfOptions>();
  const pdfOptions = (): PdfOptions => {
    const value = pdfOptionsValue();
    if (value === undefined) {
      throw new Error('Merge PDF preview options were not initialized.');
    }
    return value;
  };
  const [labelsCatalog, setLabelsCatalog] = createSignal<MessageCatalog>({});
  const t = createMemo(() => createMessageReader(labelsCatalog()));
  const [hostError, setHostError] = createSignal('');
  const [previewErrors, setPreviewErrors] = createSignal(new Set<string>());
  const [draggedSourceId, setDraggedSourceId] = createSignal('');
  const [dropTargetId, setDropTargetId] = createSignal('');

  const cancel = (): void => {
    channel.send.cancel();
  };

  onMount(() => {
    const unsubscribeMessages = channel.on({
      error: ({ message }) => {
        setHostError(message);
      },
      init: (payload) => {
        setSources([...payload.sources]);
        setPdfOptions({
          preview: payload.preview,
          resources: payload.resources,
        });
        setLabelsCatalog(payload.labels);
        setHostError('');
        setPreviewErrors(new Set<string>());
        setDraggedSourceId('');
        setDropTargetId('');
      },
    });

    channel.send.ready();

    onCleanup(() => {
      unsubscribeMessages();
    });
  });

  const moveSource = (sourceId: string, offset: number): void => {
    const current = sources();
    const fromIndex = current.findIndex((source) => source.sourceId === sourceId);
    const toIndex = fromIndex + offset;

    if (fromIndex < 0 || toIndex < 0 || toIndex >= current.length) {
      return;
    }

    const next = [...current];
    const [movedSource] = next.splice(fromIndex, 1);

    if (!movedSource) {
      return;
    }

    next.splice(toIndex, 0, movedSource);
    setSources(next);
  };

  const moveSourceTo = (sourceId: string, targetId: string): void => {
    const current = sources();
    const fromIndex = current.findIndex((source) => source.sourceId === sourceId);
    const targetIndex = current.findIndex((source) => source.sourceId === targetId);

    if (fromIndex < 0 || targetIndex < 0 || fromIndex === targetIndex) {
      return;
    }

    const next = [...current];
    const [movedSource] = next.splice(fromIndex, 1);

    if (!movedSource) {
      return;
    }

    next.splice(fromIndex < targetIndex ? targetIndex - 1 : targetIndex, 0, movedSource);
    setSources(next);
  };

  const startDragging = (event: DragEvent, sourceId: string): void => {
    setDraggedSourceId(sourceId);
    event.dataTransfer?.setData('text/plain', sourceId);
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
    }
  };

  const handleDragOver = (event: DragEvent, sourceId: string): void => {
    event.preventDefault();
    setDropTargetId(sourceId);
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
  };

  const handleDrop = (event: DragEvent, targetId: string): void => {
    event.preventDefault();
    const draggedId = draggedSourceId();
    const transferId = event.dataTransfer?.getData('text/plain');
    let sourceId = '';
    if (draggedId !== '') {
      sourceId = draggedId;
    } else if (transferId !== undefined && transferId !== '') {
      sourceId = transferId;
    }
    moveSourceTo(sourceId, targetId);
    setDraggedSourceId('');
    setDropTargetId('');
  };

  const clearDragState = (): void => {
    setDraggedSourceId('');
    setDropTargetId('');
  };

  const removeSource = (sourceId: string): void => {
    setSources((current) => current.filter((source) => source.sourceId !== sourceId));
    setPreviewErrors((current) => {
      const next = new Set(current);
      next.delete(sourceId);
      return next;
    });
  };

  const apply = (): void => {
    if (sources().length < 2) {
      return;
    }

    if (previewErrors().size > 0) {
      setHostError(t()('webview.mergePdf.previewRenderError'));
      return;
    }

    channel.send.apply({ sourceIds: sources().map((source) => source.sourceId) });
  };

  return (
    <Show when={Object.keys(labelsCatalog()).length > 0}>
      {(_labels) => (
        <main class='app'>
          <h1 class='sr-only'>{t()('webview.mergePdf.title')}</h1>

          <div class='workspace'>
            <SplitPane
              left={
                <section
                  class='panel source-panel'
                  aria-labelledby='source-list-title'
                >
                  <div class='panel__header'>
                    <div>
                      <h2 id='source-list-title'>{t()('webview.mergePdf.sourceList')}</h2>
                    </div>
                  </div>

                  <Show when={hostError()}>
                    <p
                      class='panel__error'
                      role='alert'
                    >
                      {hostError()}
                    </p>
                  </Show>

                  <div class='source-grid'>
                    <For each={sources()}>
                      {(source, index) => (
                        <SourceCard
                          source={source}
                          index={index}
                          sourceCount={sources().length}
                          t={t()}
                          options={pdfOptions()}
                          channel={channel}
                          dropTargetId={dropTargetId()}
                          handlers={{
                            onMove: moveSource,
                            onDragStart: startDragging,
                            onDragOver: handleDragOver,
                            onDrop: handleDrop,
                            onDragEnd: clearDragState,
                            onRemove: removeSource,
                            onPreviewError: () => {
                              setPreviewErrors((current) => new Set(current).add(source.sourceId));
                            },
                          }}
                        />
                      )}
                    </For>
                  </div>
                </section>
              }
              right={
                <aside
                  class='panel action-panel'
                  aria-labelledby='actions-title'
                >
                  <h2 id='actions-title'>{t()('webview.mergePdf.actions')}</h2>
                  <p class='action-panel__count'>
                    {sources().length} {t()('webview.mergePdf.sourceCount')}
                  </p>
                  <p class='action-panel__hint'>{t()('webview.mergePdf.preview')}</p>
                  <div class='actions gw-actions'>
                    <Button
                      variant='primary'
                      disabled={sources().length < 2}
                      onClick={apply}
                    >
                      {t()('webview.mergePdf.apply')}
                    </Button>
                    <Button
                      variant='secondary'
                      onClick={cancel}
                    >
                      {t()('webview.mergePdf.cancel')}
                    </Button>
                  </div>
                </aside>
              }
            />
          </div>
        </main>
      )}
    </Show>
  );
}
