import type { Accessor, JSX } from 'solid-js';

import type { SplitPdfLabels } from '@graphics-workbench-split-pdf-protocol';

import { ToolbarButton } from '../../../shared/ui/ToolbarButton';

import type { InputKind, Row } from './types';

export function GroupRow(props: {
  row: Row;
  index: Accessor<number>;
  rowCount: number;
  labels: SplitPdfLabels;
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
          label={`${props.labels.groups.drag} ${props.index() + 1}`}
          onDragEnd={props.handlers.drag.onDragEnd}
          onDragStart={(event) => {
            props.handlers.drag.onDragStart(event, props.row.id);
          }}
        />
        <div class='group-row__actions'>
          <ToolbarButton
            disabled={props.index() === 0}
            icon='codicon-chevron-up'
            label={`${props.labels.actions.moveUp} ${props.index() + 1}`}
            onClick={() => {
              props.handlers.row.onMove(props.row.id, -1);
            }}
          />
          <ToolbarButton
            disabled={props.index() === props.rowCount - 1}
            icon='codicon-chevron-down'
            label={`${props.labels.actions.moveDown} ${props.index() + 1}`}
            onClick={() => {
              props.handlers.row.onMove(props.row.id, 1);
            }}
          />
          <ToolbarButton
            icon='codicon-close'
            label={`${props.labels.groups.remove} ${props.index() + 1}`}
            onClick={() => {
              props.handlers.row.onRemove(props.row.id);
            }}
          />
        </div>
      </div>

      <div class='group-row__fields'>
        <label class='field'>
          <span class='field__label'>{props.labels.pages.title}</span>
          <input
            ref={(element) => {
              props.handlers.fields.setInputRef(props.row.id, 'pages', element);
            }}
            aria-label={`${props.labels.pages.title} ${props.index() + 1}`}
            class='input gw-input'
            placeholder={props.labels.pages.placeholder}
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
          <span class='field__label'>{props.labels.output.name}</span>
          <input
            ref={(element) => {
              props.handlers.fields.setInputRef(props.row.id, 'outputName', element);
            }}
            aria-label={`${props.labels.output.name} ${props.index() + 1}`}
            class='input gw-input'
            placeholder={props.labels.output.namePlaceholder}
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
        <span>{props.labels.output.path}:</span>{' '}
        {props.outputPathTemplate.split('__GRAPHICS_WORKBENCH_OUTPUT_NAME__').join(props.row.outputName)}
      </p>
    </article>
  );
}
