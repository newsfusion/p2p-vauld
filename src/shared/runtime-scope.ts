import { isDemoModeEnabled } from "./demo.js";

export interface RuntimeScope {
  readonly demo: boolean;
  name: (productionName: string) => string;
}

export function createRuntimeScope(demo: boolean): RuntimeScope {
  return {
    demo,
    name: (productionName) => (demo ? `demo:${productionName}` : productionName),
  };
}

export const runtimeScope = createRuntimeScope(isDemoModeEnabled);
