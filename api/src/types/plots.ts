export type PlotType = 'lightweight' | 'vega-lite' | 'mermaid';

export interface PlotSpec {
  id: string;
  type: PlotType;
  title?: string;
  caption?: string;
  data: unknown;
  spec: unknown;
  supportsInteraction: boolean;
  interactive?: boolean;
}

export type LayoutPosition = 'before' | 'after' | 'inline-context' | 'end';

export interface LayoutPlacement {
  relativeTo?: string;
  position: LayoutPosition;
}

export type LayoutSlot =
  | { type: 'text'; blockId: string; anchor?: string }
  | {
      type: 'plot';
      specId: string;
      blockId?: string;
      placement: LayoutPlacement;
      caption?: string;
      interactive?: boolean;
    };

export interface LayoutConstraints {
  maxPlotsPerSection: number;
  dedupeBySpecId: boolean;
}

export interface LayoutTree {
  version: 1;
  sections: LayoutSlot[];
  constraints: LayoutConstraints;
}

export interface StructuredBlock {
  id: string;
  kind: 'text' | 'table' | 'series' | 'ohlcv' | 'events' | 'numeric';
  text?: string;
  data?: unknown;
  schema?: string;
  units?: Record<string, string>;
}
