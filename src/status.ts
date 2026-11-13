/** What the UI shows about the script currently on the device. */
export type InvertStatus =
  | { kind: 'idle' }
  | { kind: 'applying' }
  /** `inverted`: whether the script now on the device was inverted by us */
  | { kind: 'ready'; inverted: boolean; via: 'sit' | 'stash' }
  /** playback is refused until the next successful upload */
  | { kind: 'blocked'; message: string };

export type StatusSnapshot = { status: InvertStatus; warning?: string };

export type StatusBus = ReturnType<typeof createStatusBus>;

export function createStatusBus() {
  let snapshot: StatusSnapshot = { status: { kind: 'idle' } };
  const listeners = new Set<(s: StatusSnapshot) => void>();
  const emit = () => listeners.forEach((l) => l(snapshot));
  return {
    get: () => snapshot,
    set(status: InvertStatus) {
      snapshot = { ...snapshot, status };
      emit();
    },
    warn(warning: string | undefined) {
      if (snapshot.warning === warning) return;
      snapshot = { ...snapshot, warning };
      emit();
    },
    subscribe(listener: (s: StatusSnapshot) => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
