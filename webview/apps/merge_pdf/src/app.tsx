import { For, Show, createSignal, onCleanup, onMount, type JSX } from 'solid-js';

import type { ExtensionToWebviewMessage, MergePdfSource } from './messages';
import { defaultLabels } from './labels';
import { SourceCard } from './source_card';
import type { PdfOptions } from './preview_thumbnail';
import { vscode } from './vscode';

export function App(): JSX.Element {
  const [sources, setSources] = createSignal<MergePdfSource[]>([]);
  const [pdfOptions, setPdfOptions] = createSignal<PdfOptions>({});
  const [labels, setLabels] = createSignal(defaultLabels);
  const [hostError, setHostError] = createSignal('');
  const [previewErrors, setPreviewErrors] = createSignal(new Set<string>());
  const [draggedSourceId, setDraggedSourceId] = createSignal('');
  const [dropTargetId, setDropTargetId] = createSignal('');

  onMount(() => {
    const handleMessage = (event: MessageEvent<ExtensionToWebviewMessage>): void => {
      if (event.data.type === 'error') {
        setHostError(event.data.payload.message);
        return;
      }

      const payload = event.data.payload;
      setSources(payload.sources.slice());
      setPdfOptions({
        ...(payload.workerSrc !== undefined && payload.workerSrc !== '' ? { workerSrc: payload.workerSrc } : {}),
        ...(payload.cMapUrl !== undefined && payload.cMapUrl !== '' ? { cMapUrl: payload.cMapUrl } : {}),
        ...(payload.standardFontDataUrl !== undefined && payload.standardFontDataUrl !== ''
          ? { standardFontDataUrl: payload.standardFontDataUrl }
          : {}),
        ...(payload.wasmUrl !== undefined && payload.wasmUrl !== '' ? { wasmUrl: payload.wasmUrl } : {}),
      });
      setLabels(payload.labels);
      setHostError('');
      setPreviewErrors(new Set<string>());
      setDraggedSourceId('');
      setDropTargetId('');
    };

    window.addEventListener('message', handleMessage);
    vscode.sendMessage({ type: 'ready' });

    onCleanup(() => {
      window.removeEventListener('message', handleMessage);
    });
  });

  const moveSource = (sourceId: string, offset: number): void => {
    const current = sources();
    const fromIndex = current.findIndex((source) => source.sourceId === sourceId);
    const toIndex = fromIndex + offset;

    if (fromIndex < 0 || toIndex < 0 || toIndex >= current.length) {
      return;
    }

    const next = current.slice();
    const movedSource = next.splice(fromIndex, 1)[0];

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

    const next = current.slice();
    const movedSource = next.splice(fromIndex, 1)[0];

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
      setHostError(labels().preview.renderError);
      return;
    }

    vscode.sendMessage({
      type: 'apply',
      payload: { sourceIds: sources().map((source) => source.sourceId) },
    });
  };

  return (
    <main class='app'>
      <header class='app__header'>
        <h1>{labels().header.title}</h1>
        <p>{labels().header.description}</p>
      </header>

      <div class='workspace'>
        <section
          class='panel source-panel'
          aria-labelledby='source-list-title'
        >
          <div class='panel__header'>
            <div>
              <h2 id='source-list-title'>{labels().sources.list}</h2>
              <p>{labels().sources.listDescription}</p>
            </div>
            <span class='source-count'>{sources().length}</span>
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
                  labels={labels()}
                  options={pdfOptions()}
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

        <aside
          class='panel action-panel'
          aria-labelledby='actions-title'
        >
          <h2 id='actions-title'>{labels().controls.actions}</h2>
          <p class='action-panel__count'>
            {sources().length} {labels().sources.count}
          </p>
          <p class='action-panel__hint'>{labels().preview.title}</p>
          <div class='actions'>
            <button
              class='button button--primary'
              type='button'
              disabled={sources().length < 2}
              onClick={apply}
            >
              {labels().actions.apply}
            </button>
            <button
              class='button'
              type='button'
              onClick={cancel}
            >
              {labels().actions.cancel}
            </button>
          </div>
        </aside>
      </div>
    </main>
  );
}

function cancel(): void {
  vscode.sendMessage({ type: 'cancel' });
}
