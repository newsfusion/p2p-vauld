/**
 * TypeScript resolution stub for platform-html-bundle.js.
 * Runtime tests import the committed synthetic .js fixture bundle.
 */

export const dashboards: Record<string, Promise<{ default: string }>> = {};
export const logins: Record<string, Promise<{ default: string }>> = {};

export function dashboardFixture(platformId: string): {
  id: string;
  name: string;
  fileName: string;
  html: string;
} {
  throw new Error(`Missing synthetic dashboard fixture for ${platformId}`);
}

export function loginFixture(platformId: string): {
  id: string;
  name: string;
  fileName: string;
  html: string;
} {
  throw new Error(`Missing synthetic login fixture for ${platformId}`);
}
