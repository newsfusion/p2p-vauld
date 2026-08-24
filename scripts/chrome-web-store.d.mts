export function uploadAndPublish(options: {
  accessToken: string;
  publisherId: string;
  extensionId: string;
  archive: Uint8Array;
  expectedVersion: string;
  fetchImpl?: typeof fetch;
  wait?: (milliseconds: number) => Promise<void>;
  maxPollAttempts?: number;
}): Promise<{ state: string; alreadySubmitted: boolean }>;
