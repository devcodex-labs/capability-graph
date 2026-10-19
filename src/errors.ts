import type { ErrorPhase, GraphErrorShape, NextAction } from './types.js';

export class GraphError extends Error implements GraphErrorShape {
  readonly code: string;
  readonly phase: ErrorPhase;
  readonly nextAction?: NextAction;
  constructor(code: string, phase: ErrorPhase, message: string, nextAction?: NextAction) {
    super(message); this.name = 'GraphError'; this.code = code; this.phase = phase;
    if (nextAction) this.nextAction = nextAction;
  }
  toJSON(): GraphErrorShape {
    return { code: this.code, phase: this.phase, message: this.message, ...(this.nextAction ? { nextAction: this.nextAction } : {}) };
  }
}
export function fail(code: string, phase: ErrorPhase, message: string, nextAction?: NextAction): never {
  throw new GraphError(code, phase, message, nextAction);
}
