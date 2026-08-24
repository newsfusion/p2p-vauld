import { runtimeScope } from "./runtime-scope.js";

const scoped = runtimeScope.name;

export const RUNTIME_NAMES = Object.freeze({
  trackerDatabase: scoped("p2p_tracker"),
  keystoreDatabase: scoped("p2p_keystore"),
  onboardingComplete: scoped("p2p_onboarding_complete"),
  storageSchemaVersion: scoped("p2p_storage_schema_version"),
  keySalt: scoped("p2p_key_salt"),
  verifySalt: scoped("p2p_verify_salt"),
  verifyHash: scoped("p2p_verify_hash"),
  hasMasterPassword: scoped("p2p_has_master_password"),
  sessionKey: scoped("p2p_session_key_b64"),
  activeSync: scoped("p2p_active_sync"),
  pendingAutoLock: scoped("p2p_auto_lock_pending"),
  pendingChoice: scoped("p2p_pending_choice"),
  pendingManualAction: scoped("p2p_pending_manual_action"),
  credentialPrefill: scoped("p2p_last_credential_email"),
  demoClock: scoped("p2p_demo_clock"),
  demoPlatformCohort: scoped("p2p_demo_platform_cohort"),
  theme: scoped("p2p-vauld-theme"),
  cleanupAlarm: scoped("p2p_data_cleanup"),
  syncKeepaliveAlarm: scoped("p2p_sync_keepalive"),
  syncReminderAlarm: scoped("p2p_sync_reminder"),
  sessionTimeoutAlarm: scoped("p2p_session_timeout"),
});
