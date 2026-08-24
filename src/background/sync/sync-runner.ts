import { abortableDelay, throwIfAborted } from "./cancellation.js";

interface RunPlatformsOptions {
  concurrency?: number;
  signal?: AbortSignal;
  waitForClear?: (signal?: AbortSignal) => Promise<void>;
}

interface LaunchControls {
  signal: AbortSignal | undefined;
  waitForClear: ((signal?: AbortSignal) => Promise<void>) | undefined;
}

async function defaultJitterDelay(signal?: AbortSignal): Promise<void> {
  const jitterMs = 1_500 + Math.random() * 2_000;
  await abortableDelay(jitterMs, signal);
}

async function beforeLaunch(
  index: number,
  controls?: LaunchControls,
): Promise<void> {
  const signal = controls?.signal;
  if (signal) throwIfAborted(signal);
  if (index > 0) {
    await defaultJitterDelay(signal);
  }
  await controls?.waitForClear?.(signal);
  if (signal) throwIfAborted(signal);
}

export async function runPlatformsSequentially<T>(
  platforms: T[],
  runner: (platform: T, signal?: AbortSignal) => Promise<unknown>,
  signal?: AbortSignal,
  waitForClear?: (signal?: AbortSignal) => Promise<void>,
): Promise<void> {
  for (let i = 0; i < platforms.length; i++) {
    await beforeLaunch(i, { signal, waitForClear });
    await runner(platforms[i]!, signal);
  }
}

function normalizeConcurrency(
  platforms: unknown[],
  options?: Pick<RunPlatformsOptions, "concurrency">,
): number {
  return Math.min(
    platforms.length,
    Math.max(1, Math.trunc(options?.concurrency ?? 1)),
  );
}

export async function runPlatforms<T>(
  platforms: T[],
  runner: (platform: T, signal?: AbortSignal) => Promise<unknown>,
  options?: RunPlatformsOptions,
): Promise<void> {
  const concurrency = normalizeConcurrency(platforms, options);
  if (concurrency <= 1 || platforms.length <= 1) {
    return runPlatformsSequentially(
      platforms,
      runner,
      options?.signal,
      options?.waitForClear,
    );
  }

  return new Promise<void>((resolve, reject) => {
    const controller = new AbortController();
    const parentSignal = options?.signal;
    const effectiveSignal = controller.signal;
    let finished = false;
    let nextIndex = 0;
    let settledCount = 0;
    let launchQueue = Promise.resolve();
    const abortFromParent = () => controller.abort();

    if (parentSignal?.aborted) {
      controller.abort();
    } else {
      parentSignal?.addEventListener("abort", abortFromParent, { once: true });
    }

    function cleanupParentAbort(): void {
      parentSignal?.removeEventListener("abort", abortFromParent);
    }

    function resolveOnce(): void {
      if (finished) return;
      finished = true;
      cleanupParentAbort();
      resolve();
    }

    function rejectOnce(error: unknown): void {
      if (finished) return;
      finished = true;
      controller.abort();
      cleanupParentAbort();
      reject(error);
    }

    async function claimNextIndex(): Promise<number | undefined> {
      let releaseLaunchQueue: (() => void) | undefined;
      const previousLaunch = launchQueue;
      launchQueue = new Promise<void>((resolveLaunch) => {
        releaseLaunchQueue = resolveLaunch;
      });

      try {
        await previousLaunch;
        if (finished || nextIndex >= platforms.length) {
          return undefined;
        }

        const index = nextIndex;
        nextIndex += 1;

        await beforeLaunch(index, {
          signal: effectiveSignal,
          waitForClear: options?.waitForClear,
        });
        if (finished) {
          return undefined;
        }

        return index;
      } finally {
        if (releaseLaunchQueue) {
          releaseLaunchQueue();
        }
      }
    }

    async function runWorker(): Promise<void> {
      while (!finished) {
        const index = await claimNextIndex();
        if (index === undefined || finished) {
          return;
        }

        await runner(platforms[index]!, effectiveSignal);
        settledCount += 1;

        if (settledCount === platforms.length) {
          resolveOnce();
          return;
        }
      }
    }

    const workers = Array.from({ length: concurrency }, () =>
      runWorker().catch((error) => {
        rejectOnce(error);
      }),
    );

    void Promise.allSettled(workers).then(() => {
      if (!finished && settledCount === platforms.length) {
        resolveOnce();
      }
    });
  });
}
