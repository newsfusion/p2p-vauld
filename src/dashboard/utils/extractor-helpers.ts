export function createStepTimer() {
  const t0 = Date.now();
  let last = t0;
  return {
    lap(): number {
      const now = Date.now();
      const elapsed = now - last;
      last = now;
      return elapsed;
    },
    total(): number {
      return Date.now() - t0;
    },
  };
}

export function describeLoginElement(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const type = el.getAttribute("type");
  const name = el.getAttribute("name");
  const id = el.getAttribute("id");
  const placeholder = el.getAttribute("placeholder");
  const parts = [tag];
  if (type) parts.push(`type="${type}"`);
  if (name) parts.push(`name="${name}"`);
  if (id) parts.push(`id="${id}"`);
  if (placeholder) parts.push(`placeholder="${placeholder}"`);
  return `<${parts.join(" ")}>`;
}
