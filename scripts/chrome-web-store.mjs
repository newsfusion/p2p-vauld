import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const API_ORIGIN = "https://chromewebstore.googleapis.com";
const RETRYABLE_UPLOAD_STATES = new Set(["IN_PROGRESS", "UPLOAD_IN_PROGRESS"]);
const SUCCESSFUL_UPLOAD_STATES = new Set(["SUCCEEDED", "UPLOAD_SUCCEEDED"]);
const COMPLETED_ITEM_STATES = new Set([
  "PENDING_REVIEW",
  "STAGED",
  "PUBLISHED",
  "PUBLISHED_TO_TESTERS",
]);

function validateInputs({
  accessToken,
  publisherId,
  extensionId,
  expectedVersion,
  archive,
}) {
  if (typeof accessToken !== "string" || accessToken.length < 10) {
    throw new Error("A short-lived Chrome Web Store access token is required");
  }
  if (!/^[A-Za-z0-9_-]+$/.test(publisherId)) {
    throw new Error("Invalid Chrome Web Store publisher ID");
  }
  if (!/^[a-p]{32}$/.test(extensionId)) {
    throw new Error("Invalid Chrome extension ID");
  }
  if (
    !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(expectedVersion)
  ) {
    throw new Error("Expected version must use MAJOR.MINOR.PATCH");
  }
  if (!(archive instanceof Uint8Array) || archive.byteLength === 0) {
    throw new Error("A non-empty extension ZIP archive is required");
  }
}

function apiMessage(body, fallback) {
  return body?.error?.message ?? body?.message ?? fallback;
}

async function readJsonResponse(response, operation) {
  let body;
  try {
    body = await response.json();
  } catch {
    throw new Error(
      `${operation} returned a non-JSON response (${response.status})`,
    );
  }
  if (!response.ok) {
    throw new Error(
      `${operation} failed: ${apiMessage(body, `HTTP ${response.status}`)}`,
    );
  }
  return body;
}

function revisionForVersion(status, version) {
  for (const revision of [
    status?.submittedItemRevisionStatus,
    status?.publishedItemRevisionStatus,
  ]) {
    if (
      revision?.distributionChannels?.some(
        (channel) => channel.crxVersion === version,
      )
    ) {
      return revision;
    }
  }
  return undefined;
}

export async function uploadAndPublish({
  accessToken,
  publisherId,
  extensionId,
  archive,
  expectedVersion,
  fetchImpl = fetch,
  wait = (milliseconds) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds)),
  maxPollAttempts = 30,
}) {
  validateInputs({
    accessToken,
    publisherId,
    extensionId,
    expectedVersion,
    archive,
  });
  const name = `publishers/${publisherId}/items/${extensionId}`;
  const statusUrl = `${API_ORIGIN}/v2/${name}:fetchStatus`;
  const authorization = { Authorization: `Bearer ${accessToken}` };

  const getStatus = async () =>
    readJsonResponse(
      await fetchImpl(statusUrl, { headers: authorization }),
      "Chrome Web Store status request",
    );

  const currentStatus = await getStatus();
  const existingRevision = revisionForVersion(currentStatus, expectedVersion);
  if (existingRevision && COMPLETED_ITEM_STATES.has(existingRevision.state)) {
    return { state: existingRevision.state, alreadySubmitted: true };
  }

  const uploadUrl = `${API_ORIGIN}/upload/v2/${name}:upload`;
  const upload = await readJsonResponse(
    await fetchImpl(uploadUrl, {
      method: "POST",
      headers: { ...authorization, "Content-Type": "application/zip" },
      body: archive,
    }),
    "Chrome Web Store upload",
  );

  let uploadState = upload.uploadState;
  if (SUCCESSFUL_UPLOAD_STATES.has(uploadState)) {
    if (upload.crxVersion !== expectedVersion) {
      throw new Error(
        `Chrome Web Store expected ${expectedVersion} but accepted ${upload.crxVersion ?? "an unknown version"}`,
      );
    }
  } else if (RETRYABLE_UPLOAD_STATES.has(uploadState)) {
    let completed = false;
    for (let attempt = 0; attempt < maxPollAttempts; attempt += 1) {
      await wait(10_000);
      const status = await getStatus();
      uploadState = status.lastAsyncUploadState;
      if (SUCCESSFUL_UPLOAD_STATES.has(uploadState)) {
        completed = true;
        break;
      }
      if (!RETRYABLE_UPLOAD_STATES.has(uploadState)) {
        throw new Error(
          `Chrome Web Store upload failed with state ${uploadState ?? "UNKNOWN"}`,
        );
      }
    }
    if (!completed) throw new Error("Chrome Web Store upload timed out");
  } else {
    throw new Error(
      `Chrome Web Store upload failed with state ${uploadState ?? "UNKNOWN"}`,
    );
  }

  const publishBody = {
    publishType: "DEFAULT_PUBLISH",
    skipReview: false,
    blockOnWarnings: true,
  };
  const published = await readJsonResponse(
    await fetchImpl(`${API_ORIGIN}/v2/${name}:publish`, {
      method: "POST",
      headers: { ...authorization, "Content-Type": "application/json" },
      body: JSON.stringify(publishBody),
    }),
    "Chrome Web Store review submission",
  );
  if (published.warningInfo?.warnings?.length > 0) {
    throw new Error(
      "Chrome Web Store review submission returned blocking warnings",
    );
  }
  if (!COMPLETED_ITEM_STATES.has(published.state)) {
    throw new Error(
      `Chrome Web Store returned unexpected submission state ${published.state ?? "UNKNOWN"}`,
    );
  }

  return { state: published.state, alreadySubmitted: false };
}

async function runCli() {
  const [archivePath, expectedVersion] = process.argv.slice(2);
  if (!archivePath || !expectedVersion) {
    throw new Error("Usage: chrome-web-store.mjs <archive.zip> <version>");
  }
  const result = await uploadAndPublish({
    accessToken: process.env.CHROME_ACCESS_TOKEN,
    publisherId: process.env.CHROME_PUBLISHER_ID,
    extensionId: process.env.CHROME_EXTENSION_ID,
    archive: readFileSync(archivePath),
    expectedVersion,
  });
  console.log(
    result.alreadySubmitted
      ? `Chrome Web Store version ${expectedVersion} is already ${result.state}`
      : `Chrome Web Store version ${expectedVersion} submitted: ${result.state}`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runCli().catch((error) => {
    console.error(
      error instanceof Error ? error.message : "Chrome Web Store publishing failed",
    );
    process.exitCode = 1;
  });
}
