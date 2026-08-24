/**
 * Content script — injected into P2P platform tabs.
 * Listens for messages from the background service worker and performs
 * DOM-based login and data extraction.
 */

import type {
  ContentMessage,
  LoginResponse,
  CheckLoginResponse,
  ExtractResponse,
  CaptureHtmlResponse,
  WaitForReadyResponse,
  GetTextTreeResponse,
  DismissOverlaysResponse,
  ClickDashboardLinkResponse,
} from "../shared/messages.js";
import type { CleanupStats } from "../shared/types/index.js";
import { performLogin, checkLoginState, submitOtp } from "./login.js";
import { collectFinancialCandidates } from "./extractor.js";
import { cleanHtml, waitForPageReady } from "./html-cleanup.js";
import { dismissKnownOverlays } from "./overlay-handling.js";
import { clickDashboardLink } from "./dashboard-link.js";
import { getVisibleTextTree, textTreeToString, countTextNodes } from "./text-tree.js";
import { createLogger } from "../shared/logger.js";
import { getErrorMessage } from "../shared/error-utils.js";

const log = createLogger("content");
log.debug("Content script loaded", { url: window.location.href });

/** Cached cleanup result — created by first EXTRACT call, reused across signals */
let cachedCleanup: { root: Element; stats: CleanupStats } | null = null;

function getOrCreateCleanup(): { root: Element; stats: CleanupStats } {
  if (!cachedCleanup) {
    cachedCleanup = cleanHtml();
    log.debug("HTML cleaned (cached)", {
      rawChars: cachedCleanup.stats.rawLength,
      cleanedChars: cachedCleanup.stats.cleanedLength,
      reductionPct: `${cachedCleanup.stats.reductionPct}%`,
    });
  }
  return cachedCleanup;
}

chrome.runtime.onMessage.addListener(
  (
    message: ContentMessage,
    _sender,
    sendResponse: (response: unknown) => void,
  ) => {
    switch (message.type) {
      case "LOGIN": {
        log.debug("LOGIN message received");
        const { payload } = message;
        performLogin({
          username: payload.username,
          password: payload.password,
          usernameSelectors: payload.usernameSelectors,
          passwordSelectors: payload.passwordSelectors,
          submitSelectors: payload.submitSelectors,
          otpSelectors: payload.otpSelectors,
          ...(payload.cachedLoginSelectors
            ? { cachedLoginSelectors: payload.cachedLoginSelectors }
            : {}),
          postLoginIndicators: payload.postLoginIndicators,
          stealthMode: payload.stealthMode,
          safeMode: payload.safeMode,
        })
          .then((result): LoginResponse => {
            log.debug("LOGIN completed", {
              success: result.success,
              submitted: result.submitted,
              loginTriggerClicked: result.loginTriggerClicked ?? false,
            });
            return {
              success: result.success,
              loggedIn: result.success,
              submitted: result.submitted,
              requires2FA: result.requires2FA,
              requiresCaptcha: result.requiresCaptcha,
              ...(result.loginTriggerClicked !== undefined
                ? { loginTriggerClicked: result.loginTriggerClicked }
                : {}),
              ...(result.foundElements !== undefined
                ? { foundElements: result.foundElements }
                : {}),
              ...(result.learnedLoginSelectors !== undefined
                ? { learnedLoginSelectors: result.learnedLoginSelectors }
                : {}),
              ...(result.usedLoginSelectorRoles !== undefined
                ? { usedLoginSelectorRoles: result.usedLoginSelectorRoles }
                : {}),
              ...(result.staleLoginSelectorRoles !== undefined
                ? { staleLoginSelectorRoles: result.staleLoginSelectorRoles }
                : {}),
              ...(result.error !== undefined ? { error: result.error } : {}),
            };
          })
          .finally(() => {
            payload.username = "";
            payload.password = "";
          })
          .then(sendResponse)
          .catch((err: unknown) => {
            log.warn("LOGIN failed", {
              error: getErrorMessage(err),
            });
            sendResponse({
              success: false,
              error: getErrorMessage(err),
            } satisfies LoginResponse);
          });
        return true; // Keep message channel open for async response
      }

      case "CHECK_LOGIN": {
        const result = checkLoginState(
          message.payload.postLoginIndicators,
          message.payload.otpSelectors ?? [],
          message.payload.usernameSelectors ?? [],
          message.payload.passwordSelectors ?? [],
          {
            ...(message.payload.afterSubmission !== undefined
              ? { afterSubmission: message.payload.afterSubmission }
              : {}),
            ...(message.payload.entryUrl !== undefined
              ? { entryUrl: message.payload.entryUrl }
              : {}),
          },
        );
        log.debug("CHECK_LOGIN completed", {
          loggedIn: result.success,
          sessionEvidence: result.sessionEvidence ?? false,
          url: window.location.href,
        });
        sendResponse({
          loggedIn: result.success,
          requires2FA: result.requires2FA,
          requiresCaptcha: result.requiresCaptcha,
          ...(result.credentialError ? { credentialError: true } : {}),
          ...(result.sessionEvidence ? { sessionEvidence: true } : {}),
          url: window.location.href,
        } satisfies CheckLoginResponse);
        return false;
      }

      case "WAIT_FOR_READY": {
        const { stableMs, maxWaitMs } = message.payload;
        log.debug("WAIT_FOR_READY started");
        // Invalidate cached cleanup since page content may have changed
        cachedCleanup = null;
        waitForPageReady(stableMs, maxWaitMs)
          .then((result) => {
            log.debug("WAIT_FOR_READY completed", {
              waitedMs: result.waitedMs,
              domStable: result.domStable,
              readyState: result.readyState,
            });
            sendResponse({
              ready: true,
              readyState: result.readyState,
              waitedMs: result.waitedMs,
              domStable: result.domStable,
            } satisfies WaitForReadyResponse);
          })
          .catch((err: unknown) => {
            log.warn("WAIT_FOR_READY failed", {
              error: getErrorMessage(err),
            });
            sendResponse({
              ready: false,
              readyState: document.readyState,
              waitedMs: 0,
              domStable: false,
            } satisfies WaitForReadyResponse);
          });
        return true; // Async
      }

      case "EXTRACT": {
        const { signalKey, selectors, keywords, excludeKeywords, fresh, selectorOnly } =
          message.payload;
        log.debug("EXTRACT started", { signalKey });
        try {
          if (fresh) cachedCleanup = null;
          const { root, stats } = getOrCreateCleanup();
          const { candidates, elementsScanned } = collectFinancialCandidates(
            signalKey,
            selectors,
            root,
            keywords,
            {
              ...(selectorOnly ? { selectorOnly: true } : {}),
              ...(excludeKeywords ? { excludeKeywords } : {}),
            },
          );
          log.debug("EXTRACT completed", {
            signalKey,
            candidates: candidates.length,
            elementsScanned,
            htmlRawChars: stats.rawLength,
            htmlCleanedChars: stats.cleanedLength,
          });
          sendResponse({
            success: true,
            candidates,
            elementsScanned,
            cleanupStats: stats,
          } satisfies ExtractResponse);
        } catch (err) {
          log.warn("EXTRACT failed", {
            signalKey,
            error: getErrorMessage(err),
          });
          sendResponse({
            success: false,
            error: getErrorMessage(err),
          } satisfies ExtractResponse);
        }
        return false;
      }

      case "DISMISS_OVERLAYS": {
        try {
          const result = dismissKnownOverlays();
          sendResponse({
            success: true,
            ...result,
          } satisfies DismissOverlaysResponse);
        } catch (err) {
          sendResponse({
            success: false,
            clicked: [],
            blockingOverlayDetected: false,
            error: getErrorMessage(err),
          } satisfies DismissOverlaysResponse);
        }
        return false;
      }

      case "CLICK_DASHBOARD_LINK": {
        try {
          // Page is about to change (SPA navigations don't re-inject us).
          cachedCleanup = null;
          const result = clickDashboardLink(document, message.payload);
          log.debug("CLICK_DASHBOARD_LINK completed", {
            clicked: result.clicked,
            matchText: result.matchText,
            navigationKind: result.navigationKind,
          });
          // Respond synchronously — a full navigation tears down this context
          // before an async response could be delivered.
          sendResponse({
            success: true,
            ...result,
          } satisfies ClickDashboardLinkResponse);
        } catch (err) {
          sendResponse({
            success: false,
            clicked: false,
            error: getErrorMessage(err),
          } satisfies ClickDashboardLinkResponse);
        }
        return false;
      }

      case "GET_TEXT_TREE": {
        log.debug("GET_TEXT_TREE message received");
        try {
          const tree = getVisibleTextTree(document.body);
          const { json, truncated, textNodeCount } = textTreeToString(tree);
          log.debug("GET_TEXT_TREE completed", {
            nodeCount: textNodeCount,
            length: json.length,
            truncated,
          });
          sendResponse({
            success: true,
            textTree: json,
            nodeCount: textNodeCount,
            truncated,
          } satisfies GetTextTreeResponse);
        } catch (err) {
          log.warn("GET_TEXT_TREE failed", {
            error: getErrorMessage(err),
          });
          sendResponse({
            success: false,
            error: getErrorMessage(err),
          } satisfies GetTextTreeResponse);
        }
        return false;
      }

      case "CAPTURE_HTML": {
        const { root, stats } = getOrCreateCleanup();
        log.debug("CAPTURE_HTML (cleaned)", {
          rawChars: stats.rawLength,
          cleanedChars: stats.cleanedLength,
          reductionPct: `${stats.reductionPct}%`,
        });
        sendResponse({
          html: root.innerHTML,
          cleanupStats: stats,
        } satisfies CaptureHtmlResponse);
        return false;
      }

      case "SUBMIT_OTP": {
        log.debug("SUBMIT_OTP message received");
        const { payload } = message;
        submitOtp(
          payload.code,
          payload.otpSelectors,
          payload.submitSelectors,
          payload.postLoginIndicators,
        )
          .then((success) => {
            log.debug("SUBMIT_OTP completed", { success });
            sendResponse({ success });
          })
          .catch((err: unknown) => {
            const errorMsg = getErrorMessage(err);
            log.warn("SUBMIT_OTP failed", { error: errorMsg });
            sendResponse({ success: false, error: errorMsg });
          });
        return true; // Async response
      }

      default:
        return false;
    }
  },
);
