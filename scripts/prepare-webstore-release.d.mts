export function parseReleaseVersion(version: string | undefined): string;
export function getReleaseVersionArgument(args: string[]): string | undefined;

export function alignReleaseVersions<
  P extends { version: string },
  M extends { version: string },
>(
  packageJson: P,
  manifest: M,
  version: string,
): { packageJson: P; manifest: M };

export function getReleaseArchiveArgs(archivePath: string): string[];

export function prepareWebstoreRelease(version: string): void;

export interface LocalReleaseDependencies {
  assertClean?: () => void;
  runCommand?: (command: string, args: string[]) => void;
  prepareRelease?: (version: string) => void;
  getRepositoryUrl?: () => string;
  log?: (message: string) => void;
}

export function runLocalRelease(
  version: string,
  dependencies?: LocalReleaseDependencies,
): void;
