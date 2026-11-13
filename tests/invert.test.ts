import { describe, expect, it } from 'vitest';
import {
  InvalidScriptError,
  invertForSit,
  invertForStash,
  looksLikeCustomInvert,
  stashOutputPositions,
} from '../src/invert';

const script = (positions: number[], extra: Record<string, unknown> = {}) => ({
  actions: positions.map((pos, i) => ({ at: (i + 1) * 100, pos })),
  ...extra,
});

describe('invertForSit', () => {
  it('mirrors positions: 0<->100, 25<->75, 50 stays', () => {
    expect(invertForSit(script([0, 25, 50, 75, 100])).actions.map((a) => a.pos)).toEqual([
      100, 75, 50, 25, 0,
    ]);
  });

  it('keeps timestamps, count and order exactly (also unsorted input)', () => {
    const input = { actions: [{ at: 300, pos: 10 }, { at: 100, pos: 90 }, { at: 200, pos: 0 }] };
    const out = invertForSit(input);
    expect(out.actions.map((a) => a.at)).toEqual([300, 100, 200]);
  });

  it('does not mutate the input', () => {
    const input = script([0, 40, 100], { inverted: false, metadata: { a: 1 } });
    const copy = structuredClone(input);
    invertForSit(input);
    expect(input).toEqual(copy);
  });

  it('applied twice gives the original (so "exactly once" is observable)', () => {
    const input = script([3, 97, 50]);
    expect(invertForSit(invertForSit(input)).actions).toEqual(input.actions);
  });

  it('ignores `inverted` like SIT does (SIT sends raw pos)', () => {
    expect(invertForSit(script([10], { inverted: true })).actions[0].pos).toBe(90);
  });

  it.each([
    ['null', null],
    ['no actions', {}],
    ['empty actions', { actions: [] }],
    ['NaN pos', { actions: [{ at: 0, pos: NaN }] }],
    ['Infinity at', { actions: [{ at: Infinity, pos: 1 }] }],
    ['negative at', { actions: [{ at: -1, pos: 1 }] }],
    ['pos > 100', { actions: [{ at: 0, pos: 101 }] }],
    ['pos < 0', { actions: [{ at: 0, pos: -1 }] }],
    ['string pos', { actions: [{ at: 0, pos: '50' }] }],
  ])('rejects %s without clamping', (_name, bad) => {
    expect(() => invertForSit(bad)).toThrow(InvalidScriptError);
  });
});

describe('invertForStash (Stash v0.32.0 built-in client semantics)', () => {
  const sent = (s: unknown) => stashOutputPositions(s as never);

  it('plain script: Stash would send pos, we make it send 100-pos', () => {
    const out = invertForStash(script([0, 30, 100]));
    expect(sent(out)).toEqual([100, 70, 0]);
  });

  it('inverted:true: Stash already flips once, result is flipped back exactly once more', () => {
    const input = script([0, 30, 100], { inverted: true });
    expect(sent(input)).toEqual([100, 70, 0]); // what Stash sends today
    expect(sent(invertForStash(input))).toEqual([0, 30, 100]);
  });

  it('range: normalizes like Stash then mirrors', () => {
    const input = script([0, 45, 90], { range: 90 });
    expect(sent(input)).toEqual([0, 50, 100]);
    expect(sent(invertForStash(input))).toEqual([100, 50, 0]);
  });

  it('range + inverted reproduces Stash (range wins), then mirrors once', () => {
    const input = script([0, 90], { range: 90, inverted: true });
    expect(sent(input)).toEqual([0, 100]);
    expect(sent(invertForStash(input))).toEqual([100, 0]);
  });

  it('output carries no range/inverted so Stash passes it through', () => {
    const out = invertForStash(script([10], { range: 50, inverted: true }));
    expect(out.range).toBeUndefined();
    expect(out.inverted).toBe(false);
  });

  it('validates against range', () => {
    expect(() => invertForStash(script([95], { range: 90 }))).toThrow(InvalidScriptError);
    expect(() => invertForStash(script([5], { range: -3 }))).toThrow(InvalidScriptError);
  });
});

describe('looksLikeCustomInvert', () => {
  it.each([
    'return actions.map(a => ({at: a.at, pos: 100 - a.pos}))',
    'return actions.map(({at,pos}) => ({at, pos: 100-pos}))',
    'x.pos = 100 -  x . pos',
  ])('detects %s', (text) => expect(looksLikeCustomInvert(text)).toBe(true));
  it.each(['return actions', 'pos * 0.5', undefined, 42])('ignores %s', (text) =>
    expect(looksLikeCustomInvert(text)).toBe(false),
  );
});
