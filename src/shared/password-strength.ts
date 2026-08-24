export const PASSWORD_STRENGTH_LABELS = [
  "Very weak",
  "Weak",
  "Fair",
  "Strong",
  "Very strong",
] as const;

export interface PasswordStrength {
  score: 0 | 1 | 2 | 3 | 4;
  label: (typeof PASSWORD_STRENGTH_LABELS)[number];
}

export function getPasswordStrength(password: string): PasswordStrength {
  const scoringPassword = password.trim();
  const characters = [...scoringPassword];
  const lengthPoints = [6, 10, 14, 18].filter(
    (minimum) => characters.length >= minimum,
  ).length;
  const characterClasses = [
    /\p{Ll}/u.test(scoringPassword),
    /\p{Lu}/u.test(scoringPassword),
    /\p{N}/u.test(scoringPassword),
    /[^\p{L}\p{N}\s]/u.test(scoringPassword),
  ].filter(Boolean).length;
  const symbolCount = characters.filter((character) =>
    /[^\p{L}\p{N}\s]/u.test(character),
  ).length;
  let rawScore =
    lengthPoints + Math.max(0, characterClasses - 1) + (symbolCount >= 2 ? 1 : 0);
  if (characters.length > 1 && new Set(characters).size === 1) {
    rawScore = Math.min(rawScore, 2);
  }
  const score: PasswordStrength["score"] =
    rawScore === 0
      ? 0
      : rawScore <= 2
        ? 1
        : rawScore <= 4
          ? 2
          : rawScore <= 6
            ? 3
            : 4;

  return { score, label: PASSWORD_STRENGTH_LABELS[score] };
}
