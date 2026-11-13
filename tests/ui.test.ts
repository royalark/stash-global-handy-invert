import { describe, expect, it } from 'vitest';
import { isStale } from '../src/ui';
import { createStatusBus } from '../src/status';

const settings = (enabled: boolean | undefined) => ({ enabled }) as never;

describe('isStale', () => {
  it('is stale only when the prepared script disagrees with the setting', () => {
    const status = createStatusBus();
    expect(isStale({ settings: settings(true), status })).toBe(false); // nothing prepared yet
    status.set({ kind: 'ready', via: 'sit', inverted: false });
    expect(isStale({ settings: settings(true), status })).toBe(true);
    expect(isStale({ settings: settings(false), status })).toBe(false);
    expect(isStale({ settings: settings(undefined), status })).toBe(false);
    status.set({ kind: 'applying' });
    expect(isStale({ settings: settings(true), status })).toBe(false);
  });
});
