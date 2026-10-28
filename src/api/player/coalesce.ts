import { isAbortError } from "./types.ts";

type SeekWaiter = {
  ms: number;
  resolve: () => void;
  reject: (reason: unknown) => void;
};

export function createSeekGate(
  send: (ms: number, signal: AbortSignal) => Promise<void>,
  onFail: () => Promise<void>,
) {
  let flight: Promise<void> | null = null;
  let pending: SeekWaiter | null = null;
  let epoch = 0;
  let controller: AbortController | null = null;

  const pump = () => {
    if (flight || !pending) return;
    const waiter = pending;
    pending = null;
    const request = epoch;
    const signal = new AbortController();
    controller = signal;
    const finish = () => {
      flight = null;
      if (request === epoch) pump();
    };
    let sent: Promise<void>;
    try {
      sent = Promise.resolve(send(waiter.ms, signal.signal));
    } catch (reason) {
      sent = Promise.reject(reason);
    }
    flight = sent.then(
      () => {
        finish();
        waiter.resolve();
      },
      (reason: unknown) => {
        finish();
        if (request !== epoch || isAbortError(reason)) {
          waiter.resolve();
          return;
        }
        return Promise.resolve(onFail()).then(
          () => {
            if (request === epoch) waiter.reject(reason);
            else waiter.resolve();
          },
          () => {
            if (request === epoch) waiter.reject(reason);
            else waiter.resolve();
          },
        );
      },
    );
  };

  return {
    seek(ms: number) {
      return new Promise<void>((resolve, reject) => {
        if (pending) pending.resolve();
        pending = { ms, resolve, reject };
        pump();
      });
    },
    cancel() {
      epoch += 1;
      controller?.abort();
      controller = null;
      if (pending) pending.resolve();
      pending = null;
    },
  };
}

type Schedule = (callback: () => void, ms: number) => () => void;

export function createVolumeControl(
  apply: (volume: number) => void | Promise<void>,
  delay: number,
  schedule: Schedule,
) {
  let pending: number | null = null;
  let cancel: (() => void) | null = null;
  let request = 0;
  let open = false;

  const flush = () => {
    cancel = null;
    if (pending === null || open) return;
    const value = pending;
    pending = null;
    const current = ++request;
    open = true;
    void Promise.resolve(apply(value)).finally(() => {
      if (current !== request) return;
      open = false;
      if (pending === null) return;
      cancel = schedule(flush, delay);
    });
  };

  return {
    push(volume: number) {
      pending = volume;
      if (cancel !== null || open) return;
      cancel = schedule(flush, delay);
    },
    flushNow(volume: number) {
      pending = volume;
      if (cancel) cancel();
      cancel = null;
      request += 1;
      open = false;
      flush();
    },
  };
}
