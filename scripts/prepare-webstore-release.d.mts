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
