export class CancelledError extends Error {
  constructor(message = "Cancelled") {
    super(message);
    this.name = "CancelledError";
  }
}

export class TimeoutError extends Error {
  constructor(message = "Operation timed out") {
    super(message);
    this.name = "TimeoutError";
  }
}

export interface TimeoutSignal {
  signal: AbortSignal;
  clear: () => void;
  pause: () => void;
  resume: () => void;
}

export function createTimeoutSignal(
  ms: number,
  message = "Operation timed out",
): TimeoutSignal {
  const controller = new AbortController();
  let remaining = ms;
  let startedAt = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pauseCount = 0;
  let cleared = false;

  const arm = () => {
    startedAt = Date.now();
    timer = setTimeout(() => {
      timer = undefined;
      controller.abort(new TimeoutError(message));
    }, remaining);
  };

  arm();

  return {
    signal: controller.signal,
    clear: () => {
      cleared = true;
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
    },
    pause: () => {
      pauseCount += 1;
      if (pauseCount > 1 || cleared || controller.signal.aborted) return;
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
        remaining = Math.max(0, remaining - (Date.now() - startedAt));
      }
    },
    resume: () => {
      pauseCount = Math.max(0, pauseCount - 1);
      if (
        pauseCount > 0 ||
        cleared ||
        controller.signal.aborted ||
        timer !== undefined
      ) {
        return;
      }
      arm();
    },
  };
}

function abortReason(signal: AbortSignal): Error {
  const reason = signal.reason;
  if (reason instanceof TimeoutError || reason instanceof CancelledError) {
    return reason;
  }
  if (reason instanceof Error && reason.name === "TimeoutError") {
    return new TimeoutError(reason.message);
  }
  return new CancelledError();
}

export function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortReason(signal);
}

export function abortableDelay(
  ms: number,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortReason(signal));
      return;
    }

    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);

    function onAbort() {
      clearTimeout(timer);
      reject(signal ? abortReason(signal) : new CancelledError());
    }

    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export function abortableOperation<T>(
  operation: Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  if (!signal) return operation;
  if (signal.aborted) return Promise.reject(abortReason(signal));

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      reject(abortReason(signal));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    operation.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}
