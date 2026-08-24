import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import type { KeyboardEvent } from "react";
import {
  Bug,
  Bell,
  CheckCircle,
  Clock,
  ChevronDown,
  Download,
  Eye,
  EyeOff,
  History,
  Pencil,
  RotateCcw,
  Shield,
  Sparkles,
  Trash2,
  XCircle,
} from "lucide-react";
import { PLATFORM_IDS } from "../../shared/types/index.js";
import type {
  CredentialStatusEntry,
  ExtractionChoiceSignalKey,
  PlatformId,
  SelectorProfile,
} from "../../shared/types/index.js";
import { getPlatformCatalog, listEnabledPlatforms } from "../../shared/platforms/index.js";
import { getPlatformIconUrl } from "../../shared/platforms/manifest-icons.js";
import { sendBackground } from "../../shared/messages.js";
import {
  AUTO_LOCK_TIMEOUT_OPTIONS,
  type AutoLockTimeoutMinutes,
} from "../../shared/auto-lock.js";
import { PasswordStrengthMeter } from "../../shared/components/PasswordStrengthMeter.js";
import { triggerGeminiDownload } from "../../shared/ai/gemini.js";
import { useDashboardStore } from "../store.js";
import { FormField, ModalShell, StatusBadge, SwitchToggle } from "./ui/index.js";

interface CredentialForm {
  platformId: PlatformId | null;
  username: string;
  password: string;
  safeModeEnabled: boolean;
  stealthModeEnabled: boolean;
}

const PLATFORM_ID_SET = new Set<PlatformId>(PLATFORM_IDS);

const SIGNAL_LABELS: Record<ExtractionChoiceSignalKey, string> = {
  portfolio_value: "Portfolio value",
  free_cash: "Free cash",
};

const CHOICE_SIGNAL_KEYS: ExtractionChoiceSignalKey[] = [
  "portfolio_value",
  "free_cash",
];

function formatLearnedAt(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString();
}

function getPlatformInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return `${words[0]![0] ?? ""}${words[1]![0] ?? ""}`.toUpperCase();
}

function ConnectedPlatformIcon({
  platformId,
  name,
}: {
  platformId: PlatformId;
  name: string;
}) {
  const [iconFailed, setIconFailed] = useState(false);
  const iconUrl = getPlatformIconUrl(platformId);

  return (
    <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border bg-background text-xs font-bold text-foreground shadow-sm">
      {iconUrl && !iconFailed ? (
        <img
          src={iconUrl}
          alt=""
          loading="lazy"
          decoding="async"
          className="h-6 w-6 object-contain"
          onError={() => setIconFailed(true)}
        />
      ) : (
        getPlatformInitials(name)
      )}
    </span>
  );
}

function CompactSwitch({
  label,
  checked,
  disabled = false,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-label={label}
      aria-checked={checked}
      title={label}
      disabled={disabled}
      onClick={onChange}
      className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
    >
      <span
        className={`relative h-6 w-10 rounded-full transition-colors ${
          checked ? "bg-primary" : "bg-muted"
        }`}
      >
        <span
          className={`absolute left-1 top-1 h-4 w-4 rounded-full bg-background shadow-sm transition-transform ${
            checked ? "translate-x-4" : "translate-x-0"
          }`}
        />
      </span>
    </button>
  );
}

const MIN_SYNC_REMINDER_DAYS = 1;
const MAX_SYNC_REMINDER_DAYS = 365;
const HISTORY_RETENTION_OPTIONS = [
  { value: 0, label: "Unlimited" },
  { value: 365, label: "1 year" },
  { value: 730, label: "2 years" },
  { value: 1825, label: "5 years" },
] as const;

function isPlatformId(value: string): value is PlatformId {
  return PLATFORM_ID_SET.has(value as PlatformId);
}

function clampSyncReminderDays(value: number): number {
  if (!Number.isFinite(value)) return MIN_SYNC_REMINDER_DAYS;
  return Math.min(
    MAX_SYNC_REMINDER_DAYS,
    Math.max(MIN_SYNC_REMINDER_DAYS, Math.trunc(value)),
  );
}

function getActiveConfiguredPlatformIds(
  configuredPlatformIds: PlatformId[],
  disabledPlatformIds: PlatformId[],
): PlatformId[] {
  const disabledSet = new Set(disabledPlatformIds);
  return configuredPlatformIds.filter((platformId) => !disabledSet.has(platformId));
}

export function SettingsPanel({
  onConfiguredPlatformsChange,
  onDebugModeChange,
}: {
  onConfiguredPlatformsChange?: (
    activePlatformIds: PlatformId[],
    disabledPlatformIds: PlatformId[],
  ) => void;
  onDebugModeChange?: (enabled: boolean) => void;
}) {
  const {
    geminiStatus,
    setGeminiStatus,
    geminiDownloadProgress: downloadProgress,
    setGeminiDownloadProgress,
    geminiDownloadError: downloadError,
    setGeminiDownloadError,
    geminiSettingsFocusRequest,
    isSyncing,
    setLockStatus,
  } = useDashboardStore();
  const platforms = useMemo(() => listEnabledPlatforms(), []);
  const platformCatalog = useMemo(
    () => getPlatformCatalog().filter((platform) => platform.enabled),
    [],
  );
  const platformNameById = useMemo(
    () => new Map(platforms.map((platform) => [platform.id, platform.name])),
    [platforms],
  );

  const [form, setForm] = useState<CredentialForm>({
    platformId: null,
    username: "",
    password: "",
    safeModeEnabled: false,
    stealthModeEnabled: false,
  });
  const [editingPlatformId, setEditingPlatformId] = useState<PlatformId | null>(
    null,
  );
  const [platformQuery, setPlatformQuery] = useState("");
  const [comboboxOpen, setComboboxOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [showPassword, setShowPassword] = useState(false);
  const [saving, setSaving] = useState(false);
  const [actionPlatformId, setActionPlatformId] = useState<PlatformId | null>(
    null,
  );
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(
    null,
  );
  const [configuredPlatforms, setConfiguredPlatforms] = useState<PlatformId[]>(
    [],
  );
  const [credentialModes, setCredentialModes] = useState<
    Partial<Record<PlatformId, CredentialStatusEntry>>
  >({});
  const [disabledPlatforms, setDisabledPlatforms] = useState<PlatformId[]>([]);
  const [selectorProfiles, setSelectorProfiles] = useState<
    Partial<Record<PlatformId, SelectorProfile[]>>
  >({});
  const [expandedPlatformIds, setExpandedPlatformIds] = useState<
    PlatformId[]
  >([]);
  const [debugEnabled, setDebugEnabled] = useState(false);
  const [parallelSyncEnabled, setParallelSyncEnabled] = useState(false);
  const [
    showTwoFactorManualActionDialog,
    setShowTwoFactorManualActionDialog,
  ] = useState(false);
  const [globalStealthMode, setGlobalStealthMode] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [hasMaster, setHasMaster] = useState(false);
  const [syncReminderDays, setSyncReminderDays] = useState(7);
  const [autoLockEnabled, setAutoLockEnabled] = useState(true);
  const [sessionTimeout, setSessionTimeout] =
    useState<AutoLockTimeoutMinutes>(15);
  const [historyRetentionDays, setHistoryRetentionDays] = useState(0);
  const [geminiDownloadPending, setGeminiDownloadPending] = useState(false);
  const [showMasterPasswordSetup, setShowMasterPasswordSetup] = useState(false);
  const [masterPassword, setMasterPassword] = useState("");
  const [masterPasswordConfirm, setMasterPasswordConfirm] = useState("");
  const [showMasterPassword, setShowMasterPassword] = useState(false);
  const [showMasterPasswordConfirm, setShowMasterPasswordConfirm] = useState(false);
  const [masterPasswordError, setMasterPasswordError] = useState<string | null>(null);
  const [masterPasswordSaving, setMasterPasswordSaving] = useState(false);

  const configuredPlatformsRef = useRef<PlatformId[]>([]);
  const disabledPlatformsRef = useRef<PlatformId[]>([]);
  const comboboxRef = useRef<HTMLDivElement | null>(null);
  const credentialsCardRef = useRef<HTMLDivElement | null>(null);
  const geminiCardRef = useRef<HTMLDivElement | null>(null);
  const handledGeminiFocusRequestRef = useRef(0);
  const usernameInputRef = useRef<HTMLInputElement | null>(null);

  const filteredPlatforms = useMemo(() => {
    const query = platformQuery.trim().toLowerCase();
    if (!query) return platforms;

    return platforms.filter(
      (platform) =>
        platform.name.toLowerCase().includes(query) ||
        platform.id.toLowerCase().includes(query),
    );
  }, [platformQuery, platforms]);

  const configuredRows = useMemo(
    () =>
      configuredPlatforms
        .map((platformId) => {
          const platform = platforms.find((entry) => entry.id === platformId);
          return platform ?? null;
        })
        .filter((platform): platform is (typeof platforms)[number] =>
          Boolean(platform),
        ),
    [configuredPlatforms, platforms],
  );

  const syncPlatformState = useCallback(
    (nextConfigured: PlatformId[], nextDisabled: PlatformId[]) => {
      configuredPlatformsRef.current = nextConfigured;
      disabledPlatformsRef.current = nextDisabled;
      setConfiguredPlatforms(nextConfigured);
      setDisabledPlatforms(nextDisabled);
      onConfiguredPlatformsChange?.(
        getActiveConfiguredPlatformIds(nextConfigured, nextDisabled),
        nextDisabled,
      );
    },
    [onConfiguredPlatformsChange],
  );

  function resolveModeDefaults(
    platformId: PlatformId,
    credentialEntry = credentialModes[platformId],
  ): { safeModeEnabled: boolean; stealthModeEnabled: boolean } {
    const platform = platformCatalog.find((entry) => entry.id === platformId);
    return {
      safeModeEnabled:
        credentialEntry?.safeModeEnabled ?? platform?.login.safeMode ?? false,
      stealthModeEnabled:
        credentialEntry?.stealthModeEnabled ?? globalStealthMode,
    };
  }

  function selectPlatform(
    platformId: PlatformId,
    options: { editMode?: boolean } = {},
  ) {
    const modes = resolveModeDefaults(platformId);
    setEditingPlatformId(options.editMode ? platformId : null);
    setForm((current) => ({
      ...current,
      platformId,
      password: options.editMode ? "" : current.password,
      ...modes,
    }));
    setPlatformQuery(platformNameById.get(platformId) ?? "");
    setHighlightedIndex(0);
    setComboboxOpen(false);
  }

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (!comboboxRef.current) return;
      if (comboboxRef.current.contains(event.target as Node)) return;
      setComboboxOpen(false);
      setPlatformQuery(form.platformId ? (platformNameById.get(form.platformId) ?? "") : "");
    }

    window.addEventListener("mousedown", handleClickOutside);
    return () => {
      window.removeEventListener("mousedown", handleClickOutside);
    };
  }, [form.platformId, platformNameById]);

  useEffect(() => {
    if (geminiSettingsFocusRequest <= handledGeminiFocusRequestRef.current) return;
    handledGeminiFocusRequestRef.current = geminiSettingsFocusRequest;
    geminiCardRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }, [geminiSettingsFocusRequest]);

  const fetchSelectorProfiles = useCallback(
    async (
      platformIds: PlatformId[],
    ): Promise<Partial<Record<PlatformId, SelectorProfile[]>>> => {
      const entries = await Promise.all(
        platformIds.map(async (platformId) => {
          try {
            const response = await sendBackground({
              type: "GET_SELECTOR_PROFILES",
              payload: { platformId },
            });
            return [platformId, response?.profiles ?? []] as const;
          } catch {
            return [platformId, []] as const;
          }
        }),
      );
      return Object.fromEntries(entries);
    },
    [],
  );

  const loadSelectorProfiles = useCallback(
    (platformIds: PlatformId[]): Promise<void> =>
      fetchSelectorProfiles(platformIds).then((entries) => {
        setSelectorProfiles((current) => ({ ...current, ...entries }));
      }),
    [fetchSelectorProfiles],
  );

  // A sync can store a new value selection (or replace one), so refresh the
  // remembered selections once the run has finished.
  useEffect(() => {
    if (configuredPlatforms.length === 0 || isSyncing) return undefined;
    let cancelled = false;
    void fetchSelectorProfiles(configuredPlatforms).then((entries) => {
      if (cancelled) return;
      setSelectorProfiles((current) => ({ ...current, ...entries }));
    });
    return () => {
      cancelled = true;
    };
  }, [configuredPlatforms, isSyncing, fetchSelectorProfiles]);

  useEffect(() => {
    Promise.all([
      sendBackground({ type: "GET_CREDENTIAL_STATUS" }),
      sendBackground({ type: "GET_SETTINGS" }),
      sendBackground({ type: "GET_CREDENTIAL_PREFILL" }),
      sendBackground({ type: "GET_LOCK_STATUS" }),
    ])
      .then(([credentialStatus, settingsResponse, prefillResponse, lockStatus]) => {
        const settings = settingsResponse?.settings;
        const configuredPlatformIds = credentialStatus?.platformIds ?? [];
        const credentialEntries =
          credentialStatus?.credentials ??
          configuredPlatformIds.map((platformId) => ({ platformId }));
        const nextCredentialModes = Object.fromEntries(
          credentialEntries
            .filter((entry): entry is CredentialStatusEntry =>
              Boolean(entry) &&
              typeof entry.platformId === "string" &&
              isPlatformId(entry.platformId),
            )
            .map((entry) => [entry.platformId, entry]),
        ) as Partial<Record<PlatformId, CredentialStatusEntry>>;
        const disabledPlatformIds = (settings?.disabledPlatformIds ?? []).filter(
          (platformId): platformId is PlatformId =>
            typeof platformId === "string" && isPlatformId(platformId),
        );

        setCredentialModes(nextCredentialModes);
        syncPlatformState(configuredPlatformIds, disabledPlatformIds);

        setGlobalStealthMode(settings?.stealthModeEnabled ?? false);
        setDebugEnabled(settings?.debugModeEnabled ?? false);
        setParallelSyncEnabled(settings?.parallelSyncEnabled ?? false);
        setShowTwoFactorManualActionDialog(
          settings?.showTwoFactorManualActionDialog ?? false,
        );
        setHasMaster(lockStatus?.hasMasterPassword ?? false);
        setSyncReminderDays(settings?.syncReminderDays ?? 7);
        setAutoLockEnabled(settings?.autoLockEnabled ?? true);
        setSessionTimeout(settings?.sessionTimeoutMinutes ?? 15);
        setHistoryRetentionDays(settings?.historyRetentionDays ?? 0);
        setForm((current) =>
          current.username
            ? current
            : {
                ...current,
                username: prefillResponse?.username ?? "",
              },
        );
      })
      .catch(() => undefined);
  }, [syncPlatformState]);

  function closeMasterPasswordSetup(): void {
    if (masterPasswordSaving) return;
    setShowMasterPasswordSetup(false);
    setMasterPassword("");
    setMasterPasswordConfirm("");
    setMasterPasswordError(null);
    setShowMasterPassword(false);
    setShowMasterPasswordConfirm(false);
  }

  async function handleMasterPasswordSetup(
    event: React.FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    setMasterPasswordError(null);
    if (!masterPassword) {
      setMasterPasswordError("Password is required.");
      return;
    }
    if (masterPassword !== masterPasswordConfirm) {
      setMasterPasswordError("Passwords do not match.");
      return;
    }
    if (isSyncing) {
      setMasterPasswordError(
        "Wait for the current sync to finish before setting a master password.",
      );
      return;
    }

    setMasterPasswordSaving(true);
    try {
      const response = await sendBackground({
        type: "SETUP_MASTER_PASSWORD",
        payload: { password: masterPassword },
      });
      if (!response?.success) {
        setMasterPasswordError(
          response?.error ?? "Failed to set up master password.",
        );
        return;
      }

      setHasMaster(true);
      setAutoLockEnabled(true);
      setSessionTimeout(15);
      setLockStatus({ locked: false, hasMasterPassword: true });
      setMasterPassword("");
      setMasterPasswordConfirm("");
      setShowMasterPasswordSetup(false);
    } catch {
      setMasterPasswordError("Failed to set up master password. Please try again.");
    } finally {
      setMasterPasswordSaving(false);
    }
  }

  async function saveAutoLockEnabled(enabled: boolean): Promise<void> {
    const previous = autoLockEnabled;
    setAutoLockEnabled(enabled);
    try {
      const response = await sendBackground({
        type: "SAVE_SETTINGS",
        payload: { autoLockEnabled: enabled },
      });
      if (!response?.success) throw new Error("save failed");
    } catch {
      setAutoLockEnabled(previous);
      setMessage({ text: "Failed to update Auto-Lock.", ok: false });
    }
  }

  async function saveAutoLockTimeout(
    minutes: AutoLockTimeoutMinutes,
  ): Promise<void> {
    const previous = sessionTimeout;
    setSessionTimeout(minutes);
    try {
      const response = await sendBackground({
        type: "SAVE_SETTINGS",
        payload: { sessionTimeoutMinutes: minutes },
      });
      if (!response?.success) throw new Error("save failed");
    } catch {
      setSessionTimeout(previous);
      setMessage({ text: "Failed to update Auto-Lock.", ok: false });
    }
  }

  async function handleGeminiDownload() {
    setGeminiDownloadError(null);
    setGeminiDownloadProgress(null);
    setGeminiStatus("downloading");
    setGeminiDownloadPending(true);

    try {
      const result = await triggerGeminiDownload({
        broadcast: true,
        onProgress: setGeminiDownloadProgress,
        onStatusChange: setGeminiStatus,
        onError: setGeminiDownloadError,
      });

      if (result.status === "api_not_supported") {
        const response = await sendBackground({ type: "TRIGGER_GEMINI_DOWNLOAD" });
        if (!response?.success) {
          setGeminiDownloadError("Download failed");
          setGeminiStatus("downloadable");
        }
        return;
      }

      if (result.error) {
        setGeminiDownloadError(result.error);
      }
    } catch (err) {
      try {
        const response = await sendBackground({ type: "TRIGGER_GEMINI_DOWNLOAD" });
        if (response?.success) return;
      } catch {
        // Fall through to local error state.
      }
      setGeminiDownloadError(err instanceof Error ? err.message : "Download failed");
      setGeminiStatus("downloadable");
    } finally {
      setGeminiDownloadPending(false);
    }
  }

  async function persistDisabledPlatforms(nextDisabled: PlatformId[]) {
    await sendBackground({
      type: "SAVE_SETTINGS",
      payload: { disabledPlatformIds: nextDisabled },
    });
  }

  function togglePlatformExpanded(platformId: PlatformId) {
    setExpandedPlatformIds((previous) =>
      previous.includes(platformId)
        ? previous.filter((id) => id !== platformId)
        : [...previous, platformId],
    );
  }

  async function handleToggleDisabled(platformId: PlatformId) {
    const previousDisabled = disabledPlatformsRef.current;
    const currentlyDisabled = previousDisabled.includes(platformId);
    const nextDisabled = currentlyDisabled
      ? previousDisabled.filter((id) => id !== platformId)
      : [...previousDisabled, platformId];

    setActionPlatformId(platformId);
    syncPlatformState(configuredPlatformsRef.current, nextDisabled);

    try {
      await persistDisabledPlatforms(nextDisabled);
    } catch {
      syncPlatformState(configuredPlatformsRef.current, previousDisabled);
      setMessage({ text: "Failed to update platform state.", ok: false });
    } finally {
      setActionPlatformId(null);
    }
  }

  async function handleTogglePlatformMode(
    platformId: PlatformId,
    mode: "safeModeEnabled" | "stealthModeEnabled",
  ) {
    const previousEntry = credentialModes[platformId];
    const currentModes = resolveModeDefaults(platformId, previousEntry);
    const nextEntry: CredentialStatusEntry = {
      ...previousEntry,
      platformId,
      safeModeEnabled: currentModes.safeModeEnabled,
      stealthModeEnabled: currentModes.stealthModeEnabled,
      [mode]: !currentModes[mode],
    };

    setActionPlatformId(platformId);
    setCredentialModes((current) => ({
      ...current,
      [platformId]: nextEntry,
    }));
    setMessage(null);

    try {
      const response = await sendBackground({
        type: "UPDATE_PLATFORM_MODES",
        payload: {
          platformId,
          config: { [mode]: nextEntry[mode] },
        },
      });
      if (!response.success) {
        throw new Error(response.error ?? "Failed to update platform modes.");
      }
    } catch {
      setCredentialModes((current) => {
        const next = { ...current };
        if (previousEntry) next[platformId] = previousEntry;
        else delete next[platformId];
        return next;
      });
      setMessage({ text: "Failed to update platform modes.", ok: false });
    } finally {
      setActionPlatformId(null);
    }
  }

  async function handleDelete(platformId: PlatformId) {
    const previousConfigured = configuredPlatformsRef.current;
    const previousDisabled = disabledPlatformsRef.current;

    setActionPlatformId(platformId);

    try {
      await sendBackground({
        type: "DELETE_CREDENTIALS",
        payload: { platformId },
      });

      const nextConfigured = previousConfigured.filter((id) => id !== platformId);
      const nextDisabled = previousDisabled.filter((id) => id !== platformId);

      if (nextDisabled.length !== previousDisabled.length) {
        await persistDisabledPlatforms(nextDisabled);
      }

      setCredentialModes((current) => {
        const next = { ...current };
        delete next[platformId];
        return next;
      });
      syncPlatformState(nextConfigured, nextDisabled);
      setMessage(null);
    } catch {
      setMessage({ text: "Failed to delete credentials.", ok: false });
    } finally {
      setActionPlatformId(null);
    }
  }

  async function handleResetSelectors(
    platformId: PlatformId,
    signalKey?: ExtractionChoiceSignalKey,
  ) {
    setActionPlatformId(platformId);
    setMessage(null);

    try {
      const response = await sendBackground({
        type: "RESET_PLATFORM_SELECTORS",
        payload: { platformId, ...(signalKey ? { signalKey } : {}) },
      });
      if (!response.success) {
        throw new Error(response.error ?? "Failed to reset learned selectors.");
      }
      await loadSelectorProfiles([platformId]);
      const platformName = platformNameById.get(platformId) ?? "Platform";
      setMessage({
        text: signalKey
          ? `Remembered ${SIGNAL_LABELS[signalKey]} selection reset for ${platformName}.`
          : `Learned extraction selectors reset for ${platformName}.`,
        ok: true,
      });
    } catch {
      setMessage({ text: "Failed to reset learned selectors.", ok: false });
    } finally {
      setActionPlatformId(null);
    }
  }

  function handleEdit(platformId: PlatformId) {
    selectPlatform(platformId, { editMode: true });
    setMessage(null);
    sendBackground({
      type: "GET_CREDENTIAL_EDIT_PREFILL",
      payload: { platformId },
    })
      .then((response) => {
        setForm((current) =>
          current.platformId === platformId
            ? { ...current, username: response.username ?? "" }
            : current,
        );
      })
      .catch(() => undefined);
    credentialsCardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    window.setTimeout(() => {
      usernameInputRef.current?.focus();
    }, 0);
  }

  function handleComboboxKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!comboboxOpen) {
        setComboboxOpen(true);
        return;
      }
      if (filteredPlatforms.length > 0) {
        setHighlightedIndex((current) => (current + 1) % filteredPlatforms.length);
      }
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (!comboboxOpen) {
        setComboboxOpen(true);
        return;
      }
      if (filteredPlatforms.length > 0) {
        setHighlightedIndex((current) =>
          current === 0 ? filteredPlatforms.length - 1 : current - 1,
        );
      }
      return;
    }

    if (event.key === "Enter" && comboboxOpen && filteredPlatforms[highlightedIndex]) {
      event.preventDefault();
      selectPlatform(filteredPlatforms[highlightedIndex].id);
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      setComboboxOpen(false);
      setPlatformQuery(form.platformId ? (platformNameById.get(form.platformId) ?? "") : "");
    }
  }

  function handleSave(event: React.FormEvent) {
    event.preventDefault();
    if (!form.platformId) {
      setMessage({ text: "Please select a platform.", ok: false });
      return;
    }

    setSaving(true);
    setMessage(null);

    const platformId = form.platformId;
    sendBackground({
      type: "SAVE_CREDENTIALS",
      payload: {
        platformId,
        credentials: { username: form.username, password: form.password },
        config: {
          safeModeEnabled: form.safeModeEnabled,
          stealthModeEnabled: form.stealthModeEnabled,
        },
      },
    })
      .then((response) => {
        if (response.success) {
          setMessage({ text: "Credentials saved securely.", ok: true });
          setForm((current) => ({ ...current, password: "" }));
          setCredentialModes((current) => ({
            ...current,
            [platformId]: {
              platformId,
              safeModeEnabled: form.safeModeEnabled,
              stealthModeEnabled: form.stealthModeEnabled,
            },
          }));
          const nextConfigured = configuredPlatformsRef.current.includes(platformId)
            ? configuredPlatformsRef.current
            : [...configuredPlatformsRef.current, platformId];
          syncPlatformState(nextConfigured, disabledPlatformsRef.current);
        } else {
          setMessage({
            text: response.error ?? "Failed to save credentials.",
            ok: false,
          });
        }
      })
      .finally(() => setSaving(false));
  }

  const selectedPlatformName = form.platformId
    ? (platformNameById.get(form.platformId) ?? "Platform")
    : "Platform";
  const isEditingPlatform =
    Boolean(editingPlatformId) && editingPlatformId === form.platformId;

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold leading-tight tracking-tight text-foreground md:text-4xl">
          Settings
        </h1>
        <p className="mt-2 text-base leading-relaxed text-muted-foreground">
          Manage encrypted credentials, platform state, and dashboard diagnostics.
        </p>
      </div>

      {/* xl, not lg: below 1280px a half-width card is narrower than the
          connected-platforms table's minimum, which would put its Actions
          column behind a horizontal scrollbar. */}
      <div data-testid="settings-primary-grid" className="mb-6 grid gap-6 xl:grid-cols-2">
        <div
          ref={credentialsCardRef}
          className="glass-card p-6"
          data-testid="credential-card"
        >
        <div className="mb-5 space-y-1.5">
          <h3 className="text-2xl font-semibold tracking-tight text-foreground">
            {isEditingPlatform ? `Edit ${selectedPlatformName}` : "Connect new platform"}
          </h3>
          <p className="text-sm text-muted-foreground">
            {isEditingPlatform
              ? "Update the credentials and login behavior for this platform."
              : "Connect a new P2P platform for automatic synchronization."}
          </p>
        </div>

        <form onSubmit={handleSave} className="space-y-4">
          <div className="space-y-2">
            <label
              htmlFor="platform"
              className="text-sm font-medium leading-none text-foreground"
            >
              Platform
            </label>
            <div ref={comboboxRef} className="relative">
              <input
                id="platform"
                role="combobox"
                aria-autocomplete="list"
                aria-controls="platform-listbox"
                aria-expanded={comboboxOpen}
                value={platformQuery}
                placeholder="e.g. Mintos, Bondora..."
                onChange={(event) => {
                  setEditingPlatformId(null);
                  setForm((current) => ({ ...current, platformId: null }));
                  setPlatformQuery(event.target.value);
                  setHighlightedIndex(0);
                  setComboboxOpen(true);
                }}
                onFocus={() => setComboboxOpen(true)}
                onBlur={() => {
                  window.setTimeout(() => {
                    if (!comboboxRef.current?.contains(document.activeElement)) {
                      setComboboxOpen(false);
                      setPlatformQuery(
                        form.platformId ? (platformNameById.get(form.platformId) ?? "") : "",
                      );
                    }
                  }, 0);
                }}
                onKeyDown={handleComboboxKeyDown}
                className="h-11 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary/50"
              />

              {comboboxOpen && (
                <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-md border border-border bg-card shadow-lg">
                  {filteredPlatforms.length === 0 ? (
                    <p className="px-3 py-2 text-sm text-muted-foreground">
                      No platforms found.
                    </p>
                  ) : (
                    <ul
                      id="platform-listbox"
                      role="listbox"
                      aria-label="Platform suggestions"
                      className="max-h-56 overflow-auto py-1"
                    >
                      {filteredPlatforms.map((platform, index) => {
                        const highlighted = index === highlightedIndex;
                        const selected = platform.id === form.platformId;

                        return (
                          <li key={platform.id} role="presentation">
                            <button
                              type="button"
                              role="option"
                              aria-selected={selected}
                              onMouseDown={(event) => event.preventDefault()}
                              onMouseEnter={() => setHighlightedIndex(index)}
                              onClick={() => selectPlatform(platform.id)}
                              className={[
                                "w-full px-3 py-2 text-left text-sm",
                                highlighted
                                  ? "bg-primary/10 text-foreground"
                                  : "text-foreground hover:bg-accent/40",
                                selected ? "font-medium" : "",
                              ].join(" ")}
                            >
                              {platform.name}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              )}
            </div>
          </div>

          <FormField
            id="username"
            label="Username / Email"
            labelClassName="text-sm font-medium leading-none text-foreground"
            fieldClassName="space-y-2"
          >
            <input
              id="username"
              ref={usernameInputRef}
              type="email"
              value={form.username}
              onChange={(event) =>
                setForm((current) => ({ ...current, username: event.target.value }))
              }
              placeholder="your@email.com"
              required
              autoComplete="off"
              className="h-11 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary/50"
            />
          </FormField>

          <FormField
            id="password"
            label="Password"
            labelClassName="text-sm font-medium leading-none text-foreground"
            fieldClassName="space-y-2"
          >
            <div className="relative">
              <input
                id="password"
                type={showPassword ? "text" : "password"}
                value={form.password}
                onChange={(event) =>
                  setForm((current) => ({ ...current, password: event.target.value }))
                }
                placeholder="........"
                required
                autoComplete="new-password"
                className="h-11 w-full rounded-md border border-border bg-background px-3 pr-10 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary/50"
              />
              <button
                type="button"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
                onClick={() => setShowPassword((current) => !current)}
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
          </FormField>

          <div className="rounded-lg border border-border bg-background/60">
            <button
              type="button"
              aria-label="Toggle advanced settings"
              aria-expanded={advancedOpen}
              onClick={() => setAdvancedOpen((current) => !current)}
              className="flex w-full items-center justify-between px-3 py-2.5 text-left text-sm font-semibold text-foreground"
            >
              <span>Advanced Settings</span>
              <ChevronDown
                className={[
                  "h-4 w-4 text-muted-foreground transition-transform",
                  advancedOpen ? "rotate-180" : "",
                ].join(" ")}
              />
            </button>

            {advancedOpen && (
              <div className="space-y-3 border-t border-border px-3 py-3">
                <SwitchToggle
                  label="Safe Mode"
                  description="Opens the sync window in the foreground so you can watch the login."
                  checked={form.safeModeEnabled}
                  onChange={(checked) =>
                    setForm((current) => ({
                      ...current,
                      safeModeEnabled: checked,
                    }))
                  }
                />

                <SwitchToggle
                  label="Stealth Mode"
                  description="Simulates human typing and adds human-paced pauses around login actions."
                  checked={form.stealthModeEnabled}
                  onChange={(checked) =>
                    setForm((current) => ({
                      ...current,
                      stealthModeEnabled: checked,
                    }))
                  }
                />
              </div>
            )}
          </div>

          <div
            className="flex gap-3 rounded-lg border border-primary/20 bg-primary/10 p-4"
            data-testid="privacy-notice"
          >
            <Shield className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
            <p className="text-xs leading-relaxed text-muted-foreground">
              <span className="font-medium text-foreground">Privacy Notice:</span>{" "}
              Credentials are encrypted locally on your device with AES-GCM before
              storage. <span className="font-medium text-foreground">No cloud connection.</span>
            </p>
          </div>

          {message && (
            <p className={`text-sm ${message.ok ? "text-success" : "text-destructive"}`}>
              {message.text}
            </p>
          )}

          <button
            type="submit"
            disabled={saving || !form.platformId}
          className="h-11 w-full rounded-lg bg-primary text-sm font-semibold text-primary-foreground shadow-sm transition hover:opacity-90 disabled:opacity-50"
          >
            {saving
              ? "Saving..."
              : isEditingPlatform
                ? "Save changes"
                : "Connect platform"}
          </button>
        </form>
      </div>

        <div className="glass-card p-6" data-testid="connected-platforms-card">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-2xl font-semibold tracking-tight text-foreground">
              Connected Platforms
            </h3>
            <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-semibold text-muted-foreground">
              {configuredRows.length} connected
            </span>
          </div>

          {configuredRows.length === 0 ? (
            <p className="mt-5 rounded-xl border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">
              No connected platforms yet.
            </p>
          ) : (
            <div className="mt-5 divide-y divide-border overflow-hidden rounded-xl border border-border" role="list">
              {configuredRows.map((platform) => {
                const isDisabled = disabledPlatforms.includes(platform.id);
                const rowBusy = actionPlatformId === platform.id;
                const modes = resolveModeDefaults(platform.id);
                const platformProfiles = (
                  selectorProfiles[platform.id] ?? []
                ).filter((profile): profile is SelectorProfile & {
                  signalKey: ExtractionChoiceSignalKey;
                } =>
                  CHOICE_SIGNAL_KEYS.includes(
                    profile.signalKey as ExtractionChoiceSignalKey,
                  ),
                );
                const expanded = expandedPlatformIds.includes(platform.id);
                const detailsId = `connected-platform-details-${platform.id}`;
                const activeModes = [
                  modes.safeModeEnabled ? "Safe Mode" : null,
                  modes.stealthModeEnabled ? "Stealth Mode" : null,
                ].filter((label): label is string => Boolean(label));

                return (
                  <section key={platform.id} role="listitem">
                    <div className="flex min-w-0 items-center gap-3 px-3 py-3">
                      <ConnectedPlatformIcon
                        platformId={platform.id}
                        name={platform.name}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-foreground" title={platform.name}>
                          {platform.name}
                        </p>
                        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5">
                          <StatusBadge
                            variant={isDisabled ? "warning" : "success"}
                            className="inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold"
                          >
                            {isDisabled ? "Deactivated" : "Active"}
                          </StatusBadge>
                          {activeModes.length > 0 && (
                            <span className="truncate text-xs text-muted-foreground">
                              {activeModes.join(" · ")}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <CompactSwitch
                          label={isDisabled ? `Activate ${platform.name}` : `Deactivate ${platform.name}`}
                          checked={!isDisabled}
                          disabled={rowBusy}
                          onChange={() => void handleToggleDisabled(platform.id)}
                        />
                        <button
                          type="button"
                          aria-label={`${expanded ? "Hide" : "Show"} details for ${platform.name}`}
                          aria-expanded={expanded}
                          aria-controls={detailsId}
                          onClick={() => togglePlatformExpanded(platform.id)}
                          className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                        >
                          <ChevronDown
                            className={`h-4 w-4 transition-transform ${expanded ? "rotate-180" : ""}`}
                          />
                        </button>
                      </div>
                    </div>

                    {expanded && (
                      <div
                        id={detailsId}
                        role="region"
                        aria-label={`${platform.name} settings`}
                        className="border-t border-border bg-muted/30 px-4 py-4"
                      >
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          Login behavior
                        </p>
                        <div className="mt-2 divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
                          <div className="flex items-center justify-between gap-4 px-3 py-2">
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-foreground">Safe Mode</p>
                              <p className="mt-0.5 text-xs text-muted-foreground">
                                Keep the sync window visible during login.
                              </p>
                            </div>
                            <CompactSwitch
                              label={`Toggle Safe Mode for ${platform.name}`}
                              checked={modes.safeModeEnabled}
                              disabled={rowBusy}
                              onChange={() => void handleTogglePlatformMode(platform.id, "safeModeEnabled")}
                            />
                          </div>
                          <div className="flex items-center justify-between gap-4 px-3 py-2">
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-foreground">Stealth Mode</p>
                              <p className="mt-0.5 text-xs text-muted-foreground">
                                Use human-paced typing and login pauses.
                              </p>
                            </div>
                            <CompactSwitch
                              label={`Toggle Stealth Mode for ${platform.name}`}
                              checked={modes.stealthModeEnabled}
                              disabled={rowBusy}
                              onChange={() => void handleTogglePlatformMode(platform.id, "stealthModeEnabled")}
                            />
                          </div>
                        </div>

                        {platformProfiles.length > 0 && (
                          <div
                            className="mt-4 border-t border-border pt-4"
                            data-testid={`selector-profiles-${platform.id}`}
                          >
                            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                              Remembered value selection
                            </p>
                            <div className="mt-2 space-y-1.5">
                              {platformProfiles.map((profile) => (
                                <div
                                  key={profile.signalKey}
                                  className="flex min-w-0 items-center gap-2 rounded-lg bg-card px-3 py-1.5 text-xs text-muted-foreground"
                                >
                                  <div className="min-w-0 flex-1">
                                    <p className="truncate font-medium text-foreground">
                                      {SIGNAL_LABELS[profile.signalKey]}
                                    </p>
                                    <p className="mt-0.5">
                                      {profile.source === "auto" ? "auto" : "manual"} ·{" "}
                                      {formatLearnedAt(profile.learnedAt)}
                                    </p>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      void handleResetSelectors(platform.id, profile.signalKey)
                                    }
                                    disabled={rowBusy}
                                    title={`Forget remembered ${SIGNAL_LABELS[profile.signalKey]} selection`}
                                    aria-label={`Forget remembered ${SIGNAL_LABELS[profile.signalKey]} selection for ${platform.name}`}
                                    className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-lg px-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
                                  >
                                    <RotateCcw className="h-3.5 w-3.5" />
                                    Forget
                                  </button>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        <div className="mt-4 flex flex-wrap gap-2 border-t border-border pt-4">
                          <button
                            type="button"
                            onClick={() => handleEdit(platform.id)}
                            aria-label={`Edit ${platform.name}`}
                            className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-border bg-card px-3 text-sm font-medium text-foreground transition-colors hover:bg-accent"
                          >
                            <Pencil className="h-4 w-4" />
                            Edit credentials
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleResetSelectors(platform.id)}
                            disabled={rowBusy}
                            aria-label={`Reset learned selections for ${platform.name}`}
                            className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-border bg-card px-3 text-sm font-medium text-foreground transition-colors hover:bg-accent disabled:opacity-40"
                          >
                            <RotateCcw className="h-4 w-4" />
                            Reset selections
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleDelete(platform.id)}
                            disabled={rowBusy}
                            aria-label={`Remove ${platform.name}`}
                            className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-destructive/20 bg-card px-3 text-sm font-medium text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-40"
                          >
                            <Trash2 className="h-4 w-4" />
                            Remove
                          </button>
                        </div>
                      </div>
                    )}
                  </section>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div
        ref={geminiCardRef}
        className="glass-card mb-6 p-6"
        data-testid="gemini-settings-card"
      >
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 gap-3">
            <Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
            <div className="min-w-0">
              <h3 className="text-base font-semibold text-foreground">Gemini Nano</h3>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                Improves portfolio and free cash extraction with Chrome built-in AI.
                The model runs locally in your browser.
              </p>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                {geminiStatus === null && (
                  <span className="text-xs text-muted-foreground">
                    Checking availability...
                  </span>
                )}

                {geminiStatus === "available" && (
                  <StatusBadge
                    variant="success"
                    className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium"
                  >
                    <CheckCircle className="h-3 w-3" />
                    Active
                  </StatusBadge>
                )}

                {geminiStatus === "downloadable" && (
                  <button
                    type="button"
                    onClick={handleGeminiDownload}
                    disabled={geminiDownloadPending}
                    className="inline-flex cursor-pointer items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    <Download className="h-3 w-3" />
                    {geminiDownloadPending ? "Retrying..." : "Download Gemini Nano"}
                  </button>
                )}

                {geminiStatus === "downloading" && (
                  <div className="flex min-w-[180px] flex-1 flex-wrap items-center gap-2">
                    <div className="flex min-w-[180px] flex-1 flex-col gap-1">
                      <span className="text-xs text-muted-foreground">
                        {geminiDownloadPending ? "Retrying..." : "Downloading..."}
                        {downloadProgress && downloadProgress.total > 0
                          ? ` ${Math.round((downloadProgress.loaded / downloadProgress.total) * 100)}%`
                          : ""}
                      </span>
                      {!downloadProgress && (
                        <span className="text-[11px] text-muted-foreground">
                          Waiting for progress...
                        </span>
                      )}
                      <div
                        className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
                        role="progressbar"
                        aria-label="Gemini Nano download progress"
                        {...(downloadProgress && downloadProgress.total > 0
                          ? {
                              "aria-valuemin": 0,
                              "aria-valuemax": 100,
                              "aria-valuenow": Math.round(
                                (downloadProgress.loaded / downloadProgress.total) * 100,
                              ),
                            }
                          : {})}
                      >
                        <div
                          className={[
                            "h-full rounded-full bg-primary transition-all",
                            downloadProgress && downloadProgress.total > 0
                              ? ""
                              : "w-1/3 animate-pulse",
                          ].join(" ")}
                          style={
                            downloadProgress && downloadProgress.total > 0
                              ? {
                                  width: `${(downloadProgress.loaded / downloadProgress.total) * 100}%`,
                                }
                              : undefined
                          }
                        />
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={handleGeminiDownload}
                      disabled={geminiDownloadPending}
                      className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-70"
                    >
                      <Download className="h-3 w-3" />
                      {geminiDownloadPending ? "Retrying..." : "Retry download"}
                    </button>
                  </div>
                )}

                {(geminiStatus === "unavailable" ||
                  geminiStatus === "api_not_supported") && (
                  <StatusBadge
                    variant="warning"
                    className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium"
                  >
                    <XCircle className="h-3 w-3" />
                    {geminiStatus === "api_not_supported"
                      ? "Unsupported"
                      : "Unavailable"}
                  </StatusBadge>
                )}
              </div>

              {(geminiStatus === "unavailable" ||
                geminiStatus === "api_not_supported") && (
                <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                  Use Chrome desktop and enable{" "}
                  <span className="font-medium text-foreground">
                    chrome://flags/#optimization-guide-on-device-model
                  </span>{" "}
                  plus{" "}
                  <span className="font-medium text-foreground">
                    chrome://flags/#prompt-api-for-gemini-nano
                  </span>
                  . Check model state at{" "}
                  <span className="font-medium text-foreground">
                    chrome://on-device-internals
                  </span>
                  .
                </p>
              )}

              {downloadError && (
                <p className="mt-2 text-xs text-destructive">{downloadError}</p>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="glass-card mb-6 p-6">
        <div className="flex items-start gap-6">
          <div className="flex min-w-0 flex-1 items-center gap-2 pr-4">
            <Bug className="h-4 w-4 text-muted-foreground" />
            <div>
              <h3 className="text-base font-semibold text-foreground">Debug Mode</h3>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Show extraction candidates, scores, and confidence per signal during
                sync
              </p>
            </div>
          </div>
          <SwitchToggle
            label="Debug Mode"
            checked={debugEnabled}
            onChange={() => {
              const next = !debugEnabled;
              setDebugEnabled(next);
              onDebugModeChange?.(next);
              sendBackground({
                type: "SAVE_SETTINGS",
                payload: { debugModeEnabled: next },
              });
            }}
            hideLabel
            trackClassName="relative ml-auto mt-0.5 inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors"
            knobClassName="pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform"
          />
        </div>
      </div>

      <div className="glass-card mb-6 p-6" data-testid="two-factor-dashboard-prompt-card">
        <div className="flex items-start gap-6">
          <div className="flex min-w-0 flex-1 items-center gap-2 pr-4">
            <Shield className="h-4 w-4 text-muted-foreground" />
            <div>
              <h3 className="text-base font-semibold text-foreground">
                2FA Dashboard Prompt
              </h3>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Show the dashboard code prompt when a platform asks for 2FA
              </p>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                When off, sync waits while you enter the code directly in the
                platform tab.
              </p>
            </div>
          </div>
          <SwitchToggle
            label="2FA Dashboard Prompt"
            checked={showTwoFactorManualActionDialog}
            onChange={() => {
              const next = !showTwoFactorManualActionDialog;
              setShowTwoFactorManualActionDialog(next);
              sendBackground({
                type: "SAVE_SETTINGS",
                payload: { showTwoFactorManualActionDialog: next },
              });
            }}
            testId="two-factor-dashboard-prompt-toggle"
            hideLabel
            trackClassName="relative ml-auto mt-0.5 inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors"
            knobClassName="pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform"
          />
        </div>
      </div>

      <div className="glass-card mb-6 p-6" data-testid="parallel-sync-card">
        <div className="flex items-start gap-6">
          <div className="flex min-w-0 flex-1 items-center gap-2 pr-4">
            <Sparkles className="h-4 w-4 text-muted-foreground" />
            <div>
              <h3 className="text-base font-semibold text-foreground">
                Parallel Sync
              </h3>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Run up to two platforms at once for faster syncs
              </p>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                May open more tabs, increase bot-detection risk, and make 2FA or
                Captcha flows less calm.
              </p>
            </div>
          </div>
          <SwitchToggle
            label="Parallel Sync"
            checked={parallelSyncEnabled}
            onChange={() => {
              const next = !parallelSyncEnabled;
              setParallelSyncEnabled(next);
              sendBackground({
                type: "SAVE_SETTINGS",
                payload: { parallelSyncEnabled: next },
              });
            }}
            testId="parallel-sync-toggle"
            hideLabel
            trackClassName="relative ml-auto mt-0.5 inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors"
            knobClassName="pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform"
          />
        </div>
      </div>

      <div className="glass-card mb-6 p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-6">
          <div className="flex min-w-0 flex-1 items-center gap-2 pr-4">
            <Bell className="h-4 w-4 text-muted-foreground" />
            <div>
              <h3 className="text-base font-semibold text-foreground">
                Sync Reminder
              </h3>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Show an icon badge after days without successful sync data
              </p>
            </div>
          </div>
          <div className="flex w-full sm:ml-auto sm:w-auto">
            <input
              type="number"
              min={MIN_SYNC_REMINDER_DAYS}
              max={MAX_SYNC_REMINDER_DAYS}
              step={1}
              aria-label="Sync Reminder Days"
              value={syncReminderDays}
              onChange={(event) => {
                const next = clampSyncReminderDays(Number(event.target.value));
                setSyncReminderDays(next);
                sendBackground({
                  type: "SAVE_SETTINGS",
                  payload: { syncReminderDays: next },
                });
              }}
              className="h-9 w-full rounded-l-md rounded-r-none border border-border bg-background px-3 text-sm text-foreground sm:w-20"
            />
            <span className="inline-flex h-9 items-center rounded-r-md border border-l-0 border-border bg-muted px-3 text-sm text-muted-foreground">
              days
            </span>
          </div>
        </div>
      </div>

      <div className="glass-card mb-6 p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-6">
          <div className="flex min-w-0 flex-1 items-center gap-2 pr-4">
            <History className="h-4 w-4 text-muted-foreground" />
            <div>
              <h3 className="text-base font-semibold text-foreground">
                Keep history
              </h3>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Choose how long portfolio value snapshots stay available
              </p>
              {historyRetentionDays > 0 && (
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                  Older snapshots are deleted during daily cleanup. The latest
                  snapshot per platform is always kept.
                </p>
              )}
            </div>
          </div>
          <select
            value={historyRetentionDays}
            onChange={(event) => {
              const days = Number(event.target.value);
              setHistoryRetentionDays(days);
              sendBackground({
                type: "SAVE_SETTINGS",
                payload: { historyRetentionDays: days },
              });
            }}
            className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground sm:ml-auto sm:w-40"
          >
            {HISTORY_RETENTION_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="glass-card mb-6 p-6" data-testid="security-card">
        <div className="flex items-start gap-3">
          <Shield className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold text-foreground">Security</h3>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {hasMaster
                    ? "Your encryption key is protected by a master password."
                    : "Your encryption key is stored in this local browser profile."}
                </p>
              </div>
              {hasMaster ? (
                <StatusBadge variant="success">Master password enabled</StatusBadge>
              ) : (
                <button
                  type="button"
                  disabled={isSyncing}
                  onClick={() => {
                    setMasterPasswordError(null);
                    setShowMasterPasswordSetup(true);
                  }}
                  className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Set Master Password
                </button>
              )}
            </div>

            {!hasMaster && isSyncing && (
              <p className="mt-3 text-xs text-muted-foreground">
                Available after the current sync finishes.
              </p>
            )}

            {hasMaster && (
              <div className="mt-5 border-t border-border pt-5">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1">
                    <SwitchToggle
                      label="Enable Auto-Lock"
                      description="Lock after inactivity in the dashboard or popup."
                      checked={autoLockEnabled}
                      onChange={(enabled) => void saveAutoLockEnabled(enabled)}
                    />
                  </div>
                  <label className="flex items-center gap-2 text-sm text-foreground sm:ml-auto">
                    <Clock className="h-4 w-4 text-muted-foreground" />
                    <span>After</span>
                    <select
                      aria-label="Auto-lock timeout"
                      value={sessionTimeout}
                      disabled={!autoLockEnabled}
                      onChange={(event) =>
                        void saveAutoLockTimeout(
                          Number(event.target.value) as AutoLockTimeoutMinutes,
                        )
                      }
                      className="h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {AUTO_LOCK_TIMEOUT_OPTIONS.map((minutes) => (
                        <option key={minutes} value={minutes}>
                          {minutes} min
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {showMasterPasswordSetup && (
        <ModalShell
          titleId="master-password-setup-title"
          descriptionId="master-password-setup-description"
          panelClassName="card mx-4 w-full max-w-md p-6"
        >
          <form onSubmit={handleMasterPasswordSetup} className="space-y-4">
            <div>
              <h2
                id="master-password-setup-title"
                className="text-xl font-semibold text-foreground"
              >
                Set Master Password
              </h2>
              <p
                id="master-password-setup-description"
                className="mt-2 text-sm text-muted-foreground"
              >
                Existing credentials will be re-encrypted locally. This password is
                never stored and cannot be recovered.
              </p>
            </div>

            <label className="flex flex-col gap-2 text-sm text-foreground">
              Password
              <div className="relative">
                <input
                  type={showMasterPassword ? "text" : "password"}
                  value={masterPassword}
                  onChange={(event) => setMasterPassword(event.target.value)}
                  required
                  maxLength={1024}
                  autoComplete="new-password"
                  aria-describedby={
                    masterPassword ? "settings-password-strength" : undefined
                  }
                  className="h-11 w-full rounded-md border border-border/60 bg-muted/50 px-3 pr-10 focus:border-primary/50"
                />
                <button
                  type="button"
                  aria-label={showMasterPassword ? "Hide password" : "Show password"}
                  onClick={() => setShowMasterPassword((visible) => !visible)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
                >
                  {showMasterPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
            </label>

            <PasswordStrengthMeter
              id="settings-password-strength"
              password={masterPassword}
            />

            <label className="flex flex-col gap-2 text-sm text-foreground">
              Confirm Password
              <div className="relative">
                <input
                  type={showMasterPasswordConfirm ? "text" : "password"}
                  value={masterPasswordConfirm}
                  onChange={(event) => setMasterPasswordConfirm(event.target.value)}
                  required
                  maxLength={1024}
                  autoComplete="new-password"
                  className="h-11 w-full rounded-md border border-border/60 bg-muted/50 px-3 pr-10 focus:border-primary/50"
                />
                <button
                  type="button"
                  aria-label={
                    showMasterPasswordConfirm
                      ? "Hide password confirmation"
                      : "Show password confirmation"
                  }
                  onClick={() =>
                    setShowMasterPasswordConfirm((visible) => !visible)
                  }
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
                >
                  {showMasterPasswordConfirm ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
            </label>

            {masterPasswordError && (
              <p className="error" role="alert">
                {masterPasswordError}
              </p>
            )}

            <div className="flex gap-3">
              <button
                type="button"
                onClick={closeMasterPasswordSetup}
                disabled={masterPasswordSaving}
                className="h-11 flex-1 rounded-lg border border-input bg-background text-sm font-medium text-foreground transition hover:bg-accent/40 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={masterPasswordSaving || isSyncing}
                className="h-11 flex-1 rounded-lg bg-primary text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
              >
                {masterPasswordSaving ? "Setting up…" : "Set Password"}
              </button>
            </div>
          </form>
        </ModalShell>
      )}
    </div>
  );
}
