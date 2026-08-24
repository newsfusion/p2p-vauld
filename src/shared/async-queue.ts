export interface SerialQueue {
  enqueue<T>(operation: () => Promise<T> | T): Promise<T>;
}

export function createSerialQueue(): SerialQueue {
  let tail: Promise<void> = Promise.resolve();

  return {
    enqueue<T>(operation: () => Promise<T> | T): Promise<T> {
      const next = tail.then(operation, operation);
      tail = next.then(
        () => undefined,
        () => undefined,
      );
      return next;
    },
  };
}
