/** Demo execution must not touch product drafts, preferences or session broadcasts. */
export function isolateDemoBrowserState() {
  const memory = (): Storage => {
    const values = new Map<string, string>();
    return {
      get length() { return values.size; },
      key: (index) => [...values.keys()][index] ?? null,
      getItem: (key) => values.get(String(key)) ?? null,
      setItem: (key, value) => { values.set(String(key), String(value)); },
      removeItem: (key) => { values.delete(String(key)); },
      clear: () => values.clear(),
    };
  };
  // Install before importing any client module. If isolation fails, don't boot it.
  Object.defineProperty(window, 'localStorage', { value: memory(), configurable: false });
  Object.defineProperty(window, 'sessionStorage', { value: memory(), configurable: false });
  class DemoChannel extends EventTarget {
    name: string;
    onmessage = null;
    onmessageerror = null;
    constructor(name: string) { super(); this.name = name; }
    postMessage() {}
    close() {}
  }
  Object.defineProperty(window, 'BroadcastChannel', { value: DemoChannel, configurable: false });
}
