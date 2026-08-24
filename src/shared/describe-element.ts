export function describeElement(el: Element, maxLen = 120): string {
  const tagName = el.tagName.toLowerCase();
  const classes = Array.from(el.classList).join(" ");

  // Basic HTML attribute escaping instead of CSS escaping (which escapes spaces)
  const escapeAttr = (str: string) => str.replace(/"/g, "&quot;");

  const idStr = el.id ? ` id="${escapeAttr(el.id)}"` : "";
  const classStr = classes ? ` class="${escapeAttr(classes)}"` : "";
  let typeStr = "";

  if (el instanceof HTMLInputElement && el.type) {
    typeStr = ` type="${escapeAttr(el.type)}"`;
  }

  let textContent = (el.textContent || "").replace(/\s+/g, " ").trim();
  if (textContent.length > 30) {
    textContent = textContent.slice(0, 27) + "...";
  }

  const inner = textContent ? `>${textContent}</${tagName}>` : ">";
  const description = `<${tagName}${typeStr}${idStr}${classStr}${inner}`;

  if (description.length > maxLen) {
    return description.slice(0, maxLen - 3) + "...";
  }

  return description;
}
