import type { PlatformId } from "../types/index.js";
import metadataJson from "./platform-metadata.json";

export type PlatformMetadataGroup = "invested" | "extended";

export interface PlatformMetadataEntry {
  id: string;
  name: string;
  group: PlatformMetadataGroup;
  websiteUrl: string;
  expectedReturn: string | null;
  country: string | null;
  assetType: string | null;
  notes: string | null;
  verifiedAt: string;
  connectorPlatformId?: PlatformId;
}

const metadata = metadataJson as PlatformMetadataEntry[];

export function getPlatformMetadata(): PlatformMetadataEntry[] {
  return metadata;
}

export function getPlatformMetadataById(
  id: string,
): PlatformMetadataEntry | undefined {
  return metadata.find((entry) => entry.id === id);
}

export function getPlatformMetadataByConnectorId(
  connectorPlatformId: PlatformId,
): PlatformMetadataEntry | undefined {
  return metadata.find(
    (entry) => entry.connectorPlatformId === connectorPlatformId,
  );
}

export function listPlatformMetadataByGroup(
  group: PlatformMetadataGroup,
): PlatformMetadataEntry[] {
  return metadata.filter((entry) => entry.group === group);
}
