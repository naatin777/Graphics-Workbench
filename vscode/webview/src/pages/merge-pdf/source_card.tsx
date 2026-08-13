import type { Accessor, JSX } from 'solid-js';

import type { MergePdfSource } from '@graphics-workbench/vscode-protocol/merge-pdf-protocol';

import type { MergePdfLabels } from './labels';
import { PreviewThumbnail, type MergeThumbnailChannel, type PdfOptions } from './preview_thumbnail';

export function SourceCard(props: {
  source: MergePdfSource;
  index: Accessor<number>;
  sourceCount: number;
  labels: MergePdfLabels;
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
        labels={props.labels}
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
            aria-label={props.labels.controls.dragHandle}
            title={props.labels.controls.dragHandle}
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
            aria-label={props.labels.controls.moveUp}
            title={props.labels.controls.moveUp}
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
            aria-label={props.labels.controls.moveDown}
            title={props.labels.controls.moveDown}
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
            aria-label={`${props.labels.controls.removeSource}: ${props.source.fileName}`}
            title={props.labels.controls.removeSource}
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
