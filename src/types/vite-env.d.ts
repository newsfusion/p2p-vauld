interface ImportMetaEnv {
  readonly DEV?: boolean;
  readonly PROD?: boolean;
  readonly MODE?: string;
  readonly VITE_DEMO_MODE?: string;
  readonly VITE_DEMO_BASE_URL?: string;
  readonly VITE_DEMO_COHORT_INDEX?: string;
  readonly VITE_DEMO_LOGIN_PAGE_MODE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module "*.css" {}
