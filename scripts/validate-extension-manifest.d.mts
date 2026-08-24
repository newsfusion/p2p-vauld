export type ExtensionManifest = {
  manifest_version?: number;
  name?: string;
  version?: string;
  permissions?: string[];
  optional_permissions?: string[];
  host_permissions?: string[];
  background?: { service_worker?: string };
  action?: {
    default_icon?: Record<string, string>;
    default_popup?: string;
  };
  icons?: Record<string, string>;
  content_scripts?: Array<{
    matches?: string[];
    js?: string[];
    css?: string[];
  }>;
  content_security_policy?: { extension_pages?: string };
  options_page?: string;
  options_ui?: { page?: string };
  devtools_page?: string;
  side_panel?: { default_path?: string };
  chrome_url_overrides?: Record<string, string>;
  sandbox?: { pages?: string[] };
  web_accessible_resources?: Array<{
    resources?: string[];
    matches?: string[];
    extension_ids?: string[];
    use_dynamic_url?: boolean;
  }>;
  externally_connectable?: {
    matches?: string[];
    ids?: string[];
    accepts_tls_channel_id?: boolean;
  };
};

export function validateExtensionManifest(
  manifest: ExtensionManifest,
  options: {
    rootDir: string;
    expectedVersion?: string;
    expectedHostPermissions?: string[];
    built?: boolean;
  },
): void;
