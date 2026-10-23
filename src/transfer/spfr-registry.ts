/** Explicit registry rows only. Never infer a region from a display name or chapter number. */
export function spfrRegistryRows(markdown: string) {
  const rows = new Map<string, { regionId: string; name: string; kind: string; gradeLabel: string }>();
  let regionId = '';
  for (const line of markdown.split(/\r?\n/)) {
    const heading = /^##\s+([a-z][a-z0-9-]*)\s*\(/.exec(line);
    if (heading) {
      regionId = heading[1];
      continue;
    }
    const match = /^\|\s*`([a-z0-9-]+)`\s*\|(.*)$/.exec(line);
    if (!match || !regionId) {
      continue;
    }
    if (rows.has(match[1])) {
      throw new Error(`중복 장소 명부 ID: ${match[1]}`);
    }
    const cells = match[2].split('|').map((cell) => cell.trim());
    rows.set(match[1], { regionId, name: cells[0], kind: cells[1], gradeLabel: cells[2] });
  }
  return rows;
}
