declare module "*platform-html-bundle.js" {
  import type { PlatformId } from "../shared/types/index.js";

  type HtmlFixture = string | { default: string } | { html: string };
  type HtmlFixtureImport = HtmlFixture | Promise<HtmlFixture>;

  export const logins: Partial<Record<PlatformId, HtmlFixtureImport>>;
  export const dashboards: Partial<Record<PlatformId, HtmlFixtureImport>>;
  export function dashboardFixture(platformId: PlatformId): {
    id: PlatformId;
    name: string;
    fileName: string;
    html: string;
  };
  export function loginFixture(platformId: PlatformId): {
    id: PlatformId;
    name: string;
    fileName: string;
    html: string;
  };
}
