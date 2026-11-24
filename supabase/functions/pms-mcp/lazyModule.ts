// One shared, checked load of a lazily imported module.
//
// view_drawing failed 12 times on 2026-11-16/17 with "Cannot access 'Image'
// before initialization". Every failure was on one of the two busiest days
// (360 and 118 calls) and sat beside other view_drawing calls in the same
// second. Each call ran its own `await import("imagescript")`, and that
// module's wasm helpers use top-level await: an import() that lands while the
// first one is still evaluating can be handed the module before its body has
// run, so reading `Image` throws. (Not reproduced outside the edge runtime;
// the error itself can only mean the export was read before it was set.)
//
// So: import once per isolate and share the promise; read the export through
// `pick`, and if it is not initialised yet wait briefly and read again; a
// failed load clears the memo so the next call starts over.

export const LAZY_READY_TRIES = 40;
export const LAZY_READY_WAIT_MS = 50;

export function lazyModule<T>(
  load: () => Promise<any>,
  pick: (mod: any) => T,
  opts: { tries?: number; waitMs?: number } = {},
): () => Promise<T> {
  const tries = Math.max(1, opts.tries ?? LAZY_READY_TRIES);
  const waitMs = Math.max(0, opts.waitMs ?? LAZY_READY_WAIT_MS);
  let memo: Promise<T> | null = null;
  return () => {
    if (!memo) {
      const p = (async () => {
        const mod = await load();
        for (let attempt = 1; ; attempt++) {
          try {
            const value = pick(mod);
            if (value === undefined || value === null) throw new ReferenceError("export is missing");
            return value;
          } catch (e) {
            // Only "not initialised yet" is worth waiting for.
            if (!(e instanceof ReferenceError) || attempt >= tries) throw e;
            await new Promise((r) => setTimeout(r, waitMs));
          }
        }
      })();
      memo = p;
      p.catch(() => { if (memo === p) memo = null; });
    }
    return memo;
  };
}
