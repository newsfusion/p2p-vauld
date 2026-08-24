import { describe, expect, it, vi } from "vitest";

import { uploadAndPublish } from "../../scripts/chrome-web-store.mjs";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("Chrome Web Store publishing", () => {
  it("uploads, validates, and submits a new version for automatic publishing", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          publishedItemRevisionStatus: {
            state: "PUBLISHED",
            distributionChannels: [{ crxVersion: "1.1.0", deployPercentage: 100 }],
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ uploadState: "SUCCEEDED", crxVersion: "1.2.0" }),
      )
      .mockResolvedValueOnce(jsonResponse({ state: "PENDING_REVIEW" }));

    const result = await uploadAndPublish({
      accessToken: "short-lived-token",
      publisherId: "publisher-123",
      extensionId: "abcdefghijklmnopabcdefghijklmnop",
      archive: new Uint8Array([80, 75, 3, 4]),
      expectedVersion: "1.2.0",
      fetchImpl,
      wait: async () => undefined,
    });

    expect(result).toEqual({ state: "PENDING_REVIEW", alreadySubmitted: false });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(fetchImpl.mock.calls[1]?.[1]).toMatchObject({ method: "POST" });
    expect(fetchImpl.mock.calls[2]?.[1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({
        publishType: "DEFAULT_PUBLISH",
        skipReview: false,
        blockOnWarnings: true,
      }),
    });
  });

  it("skips a rerun when the same version is already pending review", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(
      jsonResponse({
        submittedItemRevisionStatus: {
          state: "PENDING_REVIEW",
          distributionChannels: [{ crxVersion: "1.2.0", deployPercentage: 100 }],
        },
      }),
    );

    await expect(
      uploadAndPublish({
        accessToken: "short-lived-token",
        publisherId: "publisher-123",
        extensionId: "abcdefghijklmnopabcdefghijklmnop",
        archive: new Uint8Array([80, 75, 3, 4]),
        expectedVersion: "1.2.0",
        fetchImpl,
        wait: async () => undefined,
      }),
    ).resolves.toEqual({ state: "PENDING_REVIEW", alreadySubmitted: true });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("polls an asynchronous upload and fails when processing fails", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({}))
      .mockResolvedValueOnce(jsonResponse({ uploadState: "IN_PROGRESS" }))
      .mockResolvedValueOnce(jsonResponse({ lastAsyncUploadState: "FAILED" }));

    await expect(
      uploadAndPublish({
        accessToken: "short-lived-token",
        publisherId: "publisher-123",
        extensionId: "abcdefghijklmnopabcdefghijklmnop",
        archive: new Uint8Array([80, 75, 3, 4]),
        expectedVersion: "1.2.0",
        fetchImpl,
        wait: async () => undefined,
      }),
    ).rejects.toThrow(/upload failed/i);
  });

  it("submits an asynchronously processed, prevalidated archive", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({}))
      .mockResolvedValueOnce(jsonResponse({ uploadState: "IN_PROGRESS" }))
      .mockResolvedValueOnce(jsonResponse({ lastAsyncUploadState: "SUCCEEDED" }))
      .mockResolvedValueOnce(jsonResponse({ state: "PENDING_REVIEW" }));

    await expect(
      uploadAndPublish({
        accessToken: "short-lived-token",
        publisherId: "publisher-123",
        extensionId: "abcdefghijklmnopabcdefghijklmnop",
        archive: new Uint8Array([80, 75, 3, 4]),
        expectedVersion: "1.2.0",
        fetchImpl,
        wait: async () => undefined,
      }),
    ).resolves.toEqual({ state: "PENDING_REVIEW", alreadySubmitted: false });
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(fetchImpl.mock.calls[3]?.[1]).toMatchObject({ method: "POST" });
  });

  it("rejects mismatched uploaded versions and API warning failures", async () => {
    const mismatchFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({}))
      .mockResolvedValueOnce(
        jsonResponse({ uploadState: "SUCCEEDED", crxVersion: "1.2.1" }),
      );

    await expect(
      uploadAndPublish({
        accessToken: "short-lived-token",
        publisherId: "publisher-123",
        extensionId: "abcdefghijklmnopabcdefghijklmnop",
        archive: new Uint8Array([80, 75, 3, 4]),
        expectedVersion: "1.2.0",
        fetchImpl: mismatchFetch,
        wait: async () => undefined,
      }),
    ).rejects.toThrow(/expected 1\.2\.0.*1\.2\.1/i);

    const warningFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({}))
      .mockResolvedValueOnce(
        jsonResponse({ uploadState: "SUCCEEDED", crxVersion: "1.2.0" }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ error: { message: "Policy warning" } }, 400),
      );

    await expect(
      uploadAndPublish({
        accessToken: "short-lived-token",
        publisherId: "publisher-123",
        extensionId: "abcdefghijklmnopabcdefghijklmnop",
        archive: new Uint8Array([80, 75, 3, 4]),
        expectedVersion: "1.2.0",
        fetchImpl: warningFetch,
        wait: async () => undefined,
      }),
    ).rejects.toThrow(/Policy warning/);
  });
});
