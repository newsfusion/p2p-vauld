import {
  collectFinancialCandidates,
  pickBestCandidate,
} from "../../src/content/extractor.js";
import type { FinancialSignalKey } from "../../src/shared/types/index.js";

declare global {
  interface Window {
    p2pExtractor: {
      extractSignal: (
        signalKey: FinancialSignalKey,
        selectors: string[],
        keywords?: Partial<Record<FinancialSignalKey, string[]>>,
        excludeKeywords?: Partial<Record<FinancialSignalKey, string[]>>,
      ) => ReturnType<typeof pickBestCandidate> & {
        topScore: number;
        secondScore: number | null;
        elementsScanned: number;
      };
    };
  }
}

window.p2pExtractor = {
  extractSignal(signalKey, selectors, keywords, excludeKeywords) {
    const { candidates, elementsScanned } = collectFinancialCandidates(
      signalKey,
      selectors,
      document,
      keywords,
      excludeKeywords ? { excludeKeywords } : {},
    );
    const picked = pickBestCandidate(candidates);
    return {
      ...picked,
      topScore: candidates[0]?.score ?? 0,
      secondScore: candidates[1]?.score ?? null,
      elementsScanned,
    };
  },
};
