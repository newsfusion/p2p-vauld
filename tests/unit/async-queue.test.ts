import { describe, expect, it } from "vitest";
import { createSerialQueue } from "../../src/shared/async-queue.js";

describe("createSerialQueue", () => {
  it("runs operations sequentially and returns each operation result", async () => {
    const queue = createSerialQueue();
    const events: string[] = [];

    const first = queue.enqueue(async () => {
      events.push("first:start");
      await Promise.resolve();
      events.push("first:end");
      return "one";
    });
    const second = queue.enqueue(() => {
      events.push("second");
      return "two";
    });

    await expect(first).resolves.toBe("one");
    await expect(second).resolves.toBe("two");
    expect(events).toEqual(["first:start", "first:end", "second"]);
  });

  it("continues the queue after a rejected operation", async () => {
    const queue = createSerialQueue();
    const events: string[] = [];

    const first = queue.enqueue(async () => {
      events.push("reject");
      throw new Error("Nope");
    });
    const second = queue.enqueue(() => {
      events.push("next");
      return "ok";
    });

    await expect(first).rejects.toThrow("Nope");
    await expect(second).resolves.toBe("ok");
    expect(events).toEqual(["reject", "next"]);
  });
});
