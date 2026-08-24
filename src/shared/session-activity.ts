const ACTIVITY_COOLDOWN_MS = 30_000;

export function installSessionActivityTracking(
  notify: () => void,
): () => void {
  let cooldownId: number | null = null;

  const handleActivity = () => {
    if (cooldownId !== null) return;
    notify();
    cooldownId = window.setTimeout(() => {
      cooldownId = null;
    }, ACTIVITY_COOLDOWN_MS);
  };

  document.addEventListener("pointerdown", handleActivity);
  document.addEventListener("keydown", handleActivity);
  document.addEventListener("scroll", handleActivity, true);
  window.addEventListener("focus", handleActivity);

  return () => {
    document.removeEventListener("pointerdown", handleActivity);
    document.removeEventListener("keydown", handleActivity);
    document.removeEventListener("scroll", handleActivity, true);
    window.removeEventListener("focus", handleActivity);
    if (cooldownId !== null) window.clearTimeout(cooldownId);
  };
}
