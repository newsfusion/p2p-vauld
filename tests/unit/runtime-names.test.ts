import { afterEach, describe, expect, it, vi } from "vitest";

const EXPECTED_PRODUCTION_NAMES = {
  trackerDatabase: "p2p_tracker",
  keystoreDatabase: "p2p_keystore",
  onboardingComplete: "p2p_onboarding_complete",
  storageSchemaVersion: "p2p_storage_schema_version",
  keySalt: "p2p_key_salt",
  verifySalt: "p2p_verify_salt",
  verifyHash: "p2p_verify_hash",
  hasMasterPassword: "p2p_has_master_password",
  sessionKey: "p2p_session_key_b64",
  activeSync: "p2p_active_sync",
  pendingAutoLock: "p2p_auto_lock_pending",
  pendingChoice: "p2p_pending_choice",
  pendingManualAction: "p2p_pending_manual_action",
  credentialPrefill: "p2p_last_credential_email",
  demoClock: "p2p_demo_clock",
  demoPlatformCohort: "p2p_demo_platform_cohort",
  theme: "p2p-vauld-theme",
  cleanupAlarm: "p2p_data_cleanup",
  syncKeepaliveAlarm: "p2p_sync_keepalive",
  syncReminderAlarm: "p2p_sync_reminder",
  sessionTimeoutAlarm: "p2p_session_timeout",
} as const;

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("runtime names", () => {
  it("retains the existing production persistence contract", async () => {
    vi.stubEnv("VITE_DEMO_MODE", "false");

    const { RUNTIME_NAMES } = await import("../../src/shared/runtime-names.js");

    expect(RUNTIME_NAMES).toMatchObject(EXPECTED_PRODUCTION_NAMES);
  });

  it("scopes every persisted demo name away from production", async () => {
    vi.stubEnv("VITE_DEMO_MODE", "true");

    const { RUNTIME_NAMES } = await import("../../src/shared/runtime-names.js");

    for (const [name, productionValue] of Object.entries(
      EXPECTED_PRODUCTION_NAMES,
    )) {
      expect(RUNTIME_NAMES[name as keyof typeof RUNTIME_NAMES]).toBe(
        `demo:${productionValue}`,
      );
    }
  });

  it("opens both demo IndexedDB stores under scoped names", async () => {
    vi.stubEnv("VITE_DEMO_MODE", "true");

    const { db } = await import("../../src/shared/db/index.js");
    const { KEYSTORE_DB_NAME } = await import(
      "../../src/offscreen/keystore-storage.js"
    );

    expect(db.name).toBe("demo:p2p_tracker");
    expect(KEYSTORE_DB_NAME).toBe("demo:p2p_keystore");
    db.close();
  });
});
