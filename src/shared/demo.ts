import type {
  CredentialStatusEntry,
  PlatformCatalogEntry,
  PlatformId,
  PlaintextCredentials,
} from "./types/index.js";
import { PLATFORM_IDS } from "./types/index.js";

export const DEMO_PLATFORM_IDS = [
  "mintos",
  "bondora_go_grow",
  "peerberry",
  "robocash",
  "twino",
  "estateguru",
  "debitum",
  "esketit",
  "viainvest",
  "nectaro",
] as const satisfies readonly PlatformId[];

const DEMO_PLATFORM_ID_SET = new Set<PlatformId>(PLATFORM_IDS);

export const isDemoModeEnabled =
  import.meta.env.VITE_DEMO_MODE === "true" ||
  import.meta.env.VITE_DEMO_MODE === "1";

export const DEMO_BASE_URL = normalizeDemoBaseUrl(
  import.meta.env.VITE_DEMO_BASE_URL ?? "http://localhost:4180",
);

export const DEMO_LOGIN_PAGE_MODE =
  import.meta.env.VITE_DEMO_LOGIN_PAGE_MODE === "catalog-cache"
    ? "catalog-cache"
    : "mock";

export const DEMO_POST_LOGIN_INDICATOR =
  "text=/demo authenticated|portfolio value|available funds|free cash|dashboard/i";

export const DEMO_CREDENTIALS: PlaintextCredentials = {
  username: "demo@example.local",
  password: "demo-password",
};

export function normalizeDemoBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

export function isDemoPlatformId(platformId: PlatformId): boolean {
  return DEMO_PLATFORM_ID_SET.has(platformId);
}

export function getDemoCredentialStatus(
  platformIds: readonly PlatformId[] = DEMO_PLATFORM_IDS,
): CredentialStatusEntry[] {
  return platformIds.map((platformId) => ({
    platformId,
    safeModeEnabled: false,
    stealthModeEnabled: false,
  }));
}

export function applyDemoPlatformOverrides(
  platform: PlatformCatalogEntry,
  baseUrl = DEMO_BASE_URL,
): PlatformCatalogEntry {
  const normalizedBaseUrl = normalizeDemoBaseUrl(baseUrl);
  const entryUrl = `${normalizedBaseUrl}/demo/${platform.id}/login`;

  return {
    ...platform,
    domains: [...new Set([...platform.domains, "localhost", "127.0.0.1"])],
    login: {
      ...platform.login,
      entryUrl,
      postLoginIndicators: [
        ...platform.login.postLoginIndicators,
        DEMO_POST_LOGIN_INDICATOR,
      ],
      safeMode: false,
    },
  };
}

export function applyDemoCatalogOverrides(
  catalog: PlatformCatalogEntry[],
  options: {
    enabled?: boolean;
    baseUrl?: string;
  } = {},
): PlatformCatalogEntry[] {
  if (!(options.enabled ?? isDemoModeEnabled)) return catalog;
  return catalog.map((platform) =>
    applyDemoPlatformOverrides(platform, options.baseUrl ?? DEMO_BASE_URL),
  );
}
