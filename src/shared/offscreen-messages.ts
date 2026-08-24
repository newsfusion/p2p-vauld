export interface OffscreenStartHeartbeatMessage {
  type: "OFFSCREEN_START_HEARTBEAT";
  payload?: { intervalMs?: number };
}

export interface OffscreenStopHeartbeatMessage {
  type: "OFFSCREEN_STOP_HEARTBEAT";
}

export interface OffscreenHeartbeatTickMessage {
  type: "OFFSCREEN_HEARTBEAT_TICK";
  payload: { timestamp: string };
}

export type OffscreenControlMessage =
  | OffscreenStartHeartbeatMessage
  | OffscreenStopHeartbeatMessage;

export type OffscreenMessage =
  | OffscreenControlMessage
  | OffscreenHeartbeatTickMessage;

export function isOffscreenMessage(value: unknown): value is OffscreenMessage {
  if (!value || typeof value !== "object") return false;
  const type = (value as { type?: unknown }).type;
  return typeof type === "string" && type.startsWith("OFFSCREEN_");
}

export function isOffscreenControlMessage(
  value: unknown,
): value is OffscreenControlMessage {
  if (!value || typeof value !== "object") return false;
  const type = (value as { type?: unknown }).type;
  return (
    type === "OFFSCREEN_START_HEARTBEAT" ||
    type === "OFFSCREEN_STOP_HEARTBEAT"
  );
}

export function isOffscreenHeartbeatTickMessage(
  value: unknown,
): value is OffscreenHeartbeatTickMessage {
  return (
    !!value &&
    typeof value === "object" &&
    (value as { type?: unknown }).type === "OFFSCREEN_HEARTBEAT_TICK"
  );
}
