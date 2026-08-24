import type { ConnectorStrategy } from "../types/index.js";

export interface ConnectorStrategyDefinition {
  id: ConnectorStrategy;
  supportsCatalogSelectors: boolean;
}

const CONNECTOR_STRATEGIES: Record<
  ConnectorStrategy,
  ConnectorStrategyDefinition
> = {
  universal: {
    id: "universal",
    supportsCatalogSelectors: true,
  },
  special: {
    id: "special",
    supportsCatalogSelectors: false,
  },
};

export function isConnectorStrategy(value: string): value is ConnectorStrategy {
  return value in CONNECTOR_STRATEGIES;
}

export function getConnectorStrategy(
  value: string,
): ConnectorStrategyDefinition {
  if (!isConnectorStrategy(value)) {
    throw new Error(`Unknown connector strategy: ${value}`);
  }
  return CONNECTOR_STRATEGIES[value];
}
