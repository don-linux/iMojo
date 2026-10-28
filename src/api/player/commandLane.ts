import { isAbortError } from "./types.ts";

export type CommandContext = {
  epoch: number;
  signal: AbortSignal;
  live: () => boolean;
};

/**
 * One promise chain plus an AbortController, matching the bundle store `Tr`:
 * a new command aborts the previous fetch and only the latest epoch may commit.
 */
export class CommandLane {
  private chain: Promise<void> = Promise.resolve();
  private controller: AbortController | null = null;
  private epoch = 0;
  private readonly onError: (reason: unknown) => void;

  constructor(onError: (reason: unknown) => void) {
    this.onError = onError;
  }

  abort() {
    this.epoch += 1;
    this.controller?.abort();
    this.controller = null;
  }

  run(task: (context: CommandContext) => Promise<void>) {
    const epoch = ++this.epoch;
    this.controller?.abort();
    const controller = new AbortController();
    this.controller = controller;
    const signal = controller.signal;
    const live = () => epoch === this.epoch && !signal.aborted;
    const job = this.chain.then(async () => {
      if (!live()) return;
      try {
        await task({ epoch, signal, live });
      } catch (reason) {
        if (!live() || isAbortError(reason)) return;
        throw reason;
      }
    });
    this.chain = job.then(
      () => undefined,
      (reason: unknown) => {
        this.onError(reason);
      },
    );
    return this.chain;
  }

  idle() {
    return this.chain;
  }
}
