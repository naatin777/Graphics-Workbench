import type { Accessor, JSX } from 'solid-js';

import type { MergePdfSource } from '@graphics-workbench/vscode-protocol/merge-pdf-protocol';
import type { MessageReader } from '@webview-shared/messages';

import { PreviewThumbnail, type MergeThumbnailChannel, type PdfOptions } from './preview_thumbnail';

export function SourceCard(props: {
  source: MergePdfSource;
  index: Accessor<number>;
  sourceCount: number;
  t: MessageReader;
  options: PdfOptions;
  channel: MergeThumbnailChannel;
  dropTargetId: string;
  handlers: {
    onMove: (sourceId: string, offset: number) => void;
    onDragStart: (event: DragEvent, sourceId: string) => void;
    onDragOver: (event: DragEvent, sourceId: string) => void;
    onDrop: (event: DragEvent, sourceId: string) => void;
    onDragEnd: () => void;
    onRemove: (sourceId: string) => void;
    onPreviewError: () => void;
  };
}): JSX.Element {
  return (
    <article
      class='source-card'
      classList={{ 'source-card--drop-target': props.dropTargetId === props.source.sourceId }}
      onDragOver={(event) => {
        props.handlers.onDragOver(event, props.source.sourceId);
      }}
      onDrop={(event) => {
        props.handlers.onDrop(event, props.source.sourceId);
      }}
    >
      <PreviewThumbnail
        source={props.source}
        options={props.options}
        t={props.t}
        channel={props.channel}
        onError={props.handlers.onPreviewError}
      />
      <div class='source-card__content'>
        <div class='source-card__header'>
          <span class='source-card__position'>{props.index() + 1}</span>
          <h3 title={props.source.fileName}>{props.source.fileName}</h3>
        </div>

        <div class='source-card__controls'>
          <button
            class='gw-toolbar-button button--handle'
            type='button'
            draggable={true}
            aria-label={props.t('webview.mergePdf.dragHandle')}
            title={props.t('webview.mergePdf.dragHandle')}
            onDragStart={(event) => {
              props.handlers.onDragStart(event, props.source.sourceId);
            }}
            onDragEnd={props.handlers.onDragEnd}
          >
            <span
              class='codicon codicon-gripper'
              aria-hidden='true'
            />
          </button>
          <button
            class='gw-toolbar-button'
            type='button'
            disabled={props.index() === 0}
            aria-label={props.t('webview.mergePdf.moveUp')}
            title={props.t('webview.mergePdf.moveUp')}
            onClick={() => {
              props.handlers.onMove(props.source.sourceId, -1);
            }}
          >
            <span
              class='codicon codicon-chevron-up'
              aria-hidden='true'
            />
          </button>
          <button
            class='gw-toolbar-button'
            type='button'
            disabled={props.index() === props.sourceCount - 1}
            aria-label={props.t('webview.mergePdf.moveDown')}
            title={props.t('webview.mergePdf.moveDown')}
            onClick={() => {
              props.handlers.onMove(props.source.sourceId, 1);
            }}
          >
            <span
              class='codicon codicon-chevron-down'
              aria-hidden='true'
            />
          </button>
          <button
            class='gw-toolbar-button button--danger'
            type='button'
            aria-label={`${props.t('webview.mergePdf.removeSource')}: ${props.source.fileName}`}
            title={props.t('webview.mergePdf.removeSource')}
            onClick={() => {
              props.handlers.onRemove(props.source.sourceId);
            }}
          >
            <span
              class='codicon codicon-close'
              aria-hidden='true'
            />
          </button>
        </div>
      </div>
    </article>
  );
}
