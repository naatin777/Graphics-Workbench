import type { Accessor, JSX } from 'solid-js';

import type { MessageReader } from '@webview-shared/messages';
import { ToolbarButton } from '../../shared/ui/ToolbarButton';

import type { InputKind, Row } from './types';

export function GroupRow(props: {
  row: Row;
  index: Accessor<number>;
  rowCount: number;
  t: MessageReader;
  outputPathTemplate: string;
  focused: boolean;
  handlers: {
    fields: {
      setInputRef: (rowId: number, kind: InputKind, element: HTMLInputElement) => void;
      onFocus: (rowId: number) => void;
      onPagesChange: (rowId: number, pages: string) => void;
      onOutputNameChange: (rowId: number, outputName: string) => void;
      onKeyDown: (event: KeyboardEvent, rowIndex: number, kind: InputKind) => void;
    };
    row: {
      onMove: (rowId: number, direction: -1 | 1) => void;
      onRemove: (rowId: number) => void;
    };
    drag: {
      onDragStart: (event: DragEvent, rowId: number) => void;
      onDragEnd: () => void;
      onDragOver: (event: DragEvent) => void;
      onDrop: (event: DragEvent, rowId: number) => void;
    };
  };
}): JSX.Element {
  return (
    <article
      class='group-row'
      class:group-row--focused={props.focused}
      onDragOver={props.handlers.drag.onDragOver}
      onDrop={(event) => {
        props.handlers.drag.onDrop(event, props.row.id);
      }}
    >
      <div class='group-row__header'>
        <span class='group-row__number'>{props.index() + 1}</span>
        <ToolbarButton
          className='drag-handle'
          draggable={true}
          icon='codicon-gripper'
          label={`${props.t('webview.splitPdf.dragGroup')} ${props.index() + 1}`}
          onDragEnd={props.handlers.drag.onDragEnd}
          onDragStart={(event) => {
            props.handlers.drag.onDragStart(event, props.row.id);
          }}
        />
        <div class='group-row__actions'>
          <ToolbarButton
            disabled={props.index() === 0}
            icon='codicon-chevron-up'
            label={`${props.t('webview.splitPdf.moveUp')} ${props.index() + 1}`}
            onClick={() => {
              props.handlers.row.onMove(props.row.id, -1);
            }}
          />
          <ToolbarButton
            disabled={props.index() === props.rowCount - 1}
            icon='codicon-chevron-down'
            label={`${props.t('webview.splitPdf.moveDown')} ${props.index() + 1}`}
            onClick={() => {
              props.handlers.row.onMove(props.row.id, 1);
            }}
          />
          <ToolbarButton
            icon='codicon-close'
            label={`${props.t('webview.splitPdf.removeGroup')} ${props.index() + 1}`}
            onClick={() => {
              props.handlers.row.onRemove(props.row.id);
            }}
          />
        </div>
      </div>

      <div class='group-row__fields'>
        <label class='field'>
          <span class='field__label'>{props.t('webview.splitPdf.pages')}</span>
          <input
            ref={(element) => {
              props.handlers.fields.setInputRef(props.row.id, 'pages', element);
            }}
            aria-label={`${props.t('webview.splitPdf.pages')} ${props.index() + 1}`}
            class='gw-input'
            placeholder={props.t('webview.splitPdf.pagesPlaceholder')}
            type='text'
            value={props.row.pages}
            onFocus={() => {
              props.handlers.fields.onFocus(props.row.id);
            }}
            onInput={(event) => {
              props.handlers.fields.onPagesChange(props.row.id, event.currentTarget.value);
            }}
            onKeyDown={(event) => {
              props.handlers.fields.onKeyDown(event, props.index(), 'pages');
            }}
          />
        </label>
        <label class='field'>
          <span class='field__label'>{props.t('webview.splitPdf.outputName')}</span>
          <input
            ref={(element) => {
              props.handlers.fields.setInputRef(props.row.id, 'outputName', element);
            }}
            aria-label={`${props.t('webview.splitPdf.outputName')} ${props.index() + 1}`}
            class='gw-input'
            placeholder={props.t('webview.splitPdf.outputNamePlaceholder')}
            type='text'
            value={props.row.outputName}
            onFocus={() => {
              props.handlers.fields.onFocus(props.row.id);
            }}
            onInput={(event) => {
              props.handlers.fields.onOutputNameChange(props.row.id, event.currentTarget.value);
            }}
            onKeyDown={(event) => {
              props.handlers.fields.onKeyDown(event, props.index(), 'outputName');
            }}
          />
        </label>
      </div>
      <p class='group-row__output-path'>
        <span>{props.t('webview.splitPdf.outputPath')}:</span>{' '}
        {props.outputPathTemplate.split('__GRAPHICS_WORKBENCH_OUTPUT_NAME__').join(props.row.outputName)}
      </p>
    </article>
  );
}
