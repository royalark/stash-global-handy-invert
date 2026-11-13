/**
 * Pure funscript transforms. No I/O, never mutates its input.
 *
 * "Invert" means: mirror what the device would otherwise have received, in the
 * device's 0..100 coordinate space (pos' = 100 - pos). Timestamps, action
 * count and order are kept exactly.
 *
 * Two upload pipelines exist and they interpret a funscript differently, so
 * there is one entry point per pipeline:
 *  - StashInteractiveTools sends raw `pos` (it ignores `inverted`, and its
 *    modification pipeline drops `range`)          -> invertForSit
 *  - Stash's built-in client honours `inverted` / `range` -> invertForStash
 */

import { t } from './i18n';

export type Action = { at: number; pos: number; [key: string]: unknown };
export type FunscriptLike = {
  actions: Action[];
  inverted?: boolean;
  range?: number;
  [key: string]: unknown;
};

export class InvalidScriptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidScriptError';
  }
}

const isFiniteNumber = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v);

/** Validates without clamping. Messages never contain script content. */
export function validateScript(
  script: unknown,
  maxPos = 100,
): asserts script is FunscriptLike {
  if (!script || typeof script !== 'object')
    throw new InvalidScriptError(t('errNotObject'));
  const actions = (script as FunscriptLike).actions;
  if (!Array.isArray(actions) || actions.length === 0)
    throw new InvalidScriptError(t('errNoActions'));
  for (let i = 0; i < actions.length; i++) {
    const a = actions[i];
    if (!a || typeof a !== 'object')
      throw new InvalidScriptError(t('errAction', { i }));
    if (!isFiniteNumber(a.at) || a.at < 0)
      throw new InvalidScriptError(t('errAt', { i }));
    if (!isFiniteNumber(a.pos) || a.pos < 0 || a.pos > maxPos)
      throw new InvalidScriptError(
        t('errPos', { i, max: maxPos }),
      );
  }
}

function mirror(actions: Action[], positions: number[]): Action[] {
  return actions.map((a, i) => ({ ...a, pos: 100 - positions[i] }));
}

/** For StashInteractiveTools: it sends `pos` as-is. */
export function invertForSit(script: unknown): FunscriptLike {
  validateScript(script, 100);
  return {
    ...script,
    actions: mirror(
      script.actions,
      script.actions.map((a) => a.pos),
    ),
  };
}

function convertRange(
  value: number,
  fromLow: number,
  fromHigh: number,
  toLow: number,
  toHigh: number,
) {
  return ((value - fromLow) * (toHigh - toLow)) / (fromHigh - fromLow) + toLow;
}

/**
 * Positions Stash v0.32.0's built-in Handy client would send
 * (ui/v2.5/src/hooks/Interactive/interactive.ts, convertFunscriptToCSV).
 * Reproduced exactly - including that a truthy `range` recomputes from the
 * raw `pos` and so discards `inverted` - so that OFF/ON differ by exactly one
 * mirror and nothing else.
 */
export function stashOutputPositions(script: FunscriptLike): number[] {
  return script.actions.map((a) => {
    let pos = a.pos;
    if (script.inverted === true) pos = convertRange(a.pos, 0, 100, 100, 0);
    if (script.range) pos = convertRange(a.pos, 0, script.range, 0, 100);
    return pos;
  });
}

/** For Stash's built-in client: returns a script it passes through unchanged. */
export function invertForStash(script: unknown): FunscriptLike {
  const range = (script as FunscriptLike | null)?.range;
  if (range !== undefined && range !== null && range !== 0) {
    if (!isFiniteNumber(range) || range <= 0)
      throw new InvalidScriptError(t('errRange'));
  }
  validateScript(script, range ? range : 100);
  const out = mirror(script.actions, stashOutputPositions(script));
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { range: _range, inverted: _inverted, ...rest } = script;
  return { ...rest, inverted: false, actions: out };
}

/** Heuristic: does a SIT Custom modifier already mirror positions? */
export function looksLikeCustomInvert(functionText: unknown): boolean {
  return (
    typeof functionText === 'string' &&
    /100\s*-\s*(?:[A-Za-z_$][\w$]*\s*\.\s*)?pos\b/.test(functionText)
  );
}
