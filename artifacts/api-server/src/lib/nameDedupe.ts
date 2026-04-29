export type MatchType = "exact" | "stem" | "edit1";

export type NameRecord = {
  id: number;
  name: string;
  code?: string | null;
  groupKey?: string | number | null;
  groupName?: string | null;
};

export type NameDuplicateMatch = {
  id: number;
  name: string;
  code: string | null;
  groupKey: string | number | null;
  groupName: string | null;
  matchType: MatchType;
  sameGroup: boolean;
};

export function normalizeName(s: string): string {
  return (s || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stemWord(w: string): string {
  if (w.length <= 2) return w;
  if (w.endsWith("ies") && w.length > 3) return w.slice(0, -3) + "y";
  if (w.endsWith("ses") && w.length > 4) return w.slice(0, -2);
  if (w.endsWith("xes") || w.endsWith("zes") || w.endsWith("ches") || w.endsWith("shes")) return w.slice(0, -2);
  if (w.endsWith("ves") && w.length > 3) return w.slice(0, -3) + "f";
  if (w.endsWith("oes") && w.length > 4) return w.slice(0, -2);
  if (w.endsWith("ies") && w.length > 4) return w.slice(0, -3) + "y";
  if (w.endsWith("es") && w.length > 3) return w.slice(0, -1);
  if (w.endsWith("s") && !w.endsWith("ss") && w.length > 3) return w.slice(0, -1);
  return w;
}

export function normalizeStem(s: string): string {
  return normalizeName(s).split(" ").map(stemWord).filter(Boolean).join(" ");
}

export function editDistanceLeq(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = new Array(n + 1);
  let curr = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    let rowMin = curr[0];
    for (let j = 1; j <= n; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
      if (curr[j] < rowMin) rowMin = curr[j];
    }
    if (rowMin > max) return max + 1;
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

function sameGroupValue(a: string | number | null | undefined, b: string | number | null | undefined): boolean {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return a === b;
}

export function findNameDuplicates<T extends NameRecord>(
  name: string,
  groupKey: string | number | null | undefined,
  pool: T[],
  excludeId?: number,
): NameDuplicateMatch[] {
  const targetNorm = normalizeName(name);
  if (!targetNorm) return [];
  const targetStem = normalizeStem(name);
  const out: NameDuplicateMatch[] = [];
  const seen = new Set<number>();
  for (const rec of pool) {
    if (excludeId != null && rec.id === excludeId) continue;
    if (seen.has(rec.id)) continue;
    const otherNorm = normalizeName(rec.name);
    if (!otherNorm) continue;
    let matchType: MatchType | null = null;
    if (otherNorm === targetNorm) matchType = "exact";
    else {
      const otherStem = normalizeStem(rec.name);
      if (otherStem === targetStem && otherStem.length > 0) matchType = "stem";
      else if (Math.min(targetNorm.length, otherNorm.length) >= 4 && editDistanceLeq(targetNorm, otherNorm, 1) <= 1) matchType = "edit1";
    }
    if (matchType) {
      seen.add(rec.id);
      out.push({
        id: rec.id,
        name: rec.name,
        code: rec.code ?? null,
        groupKey: rec.groupKey ?? null,
        groupName: rec.groupName ?? null,
        matchType,
        sameGroup: sameGroupValue(rec.groupKey, groupKey),
      });
    }
  }
  out.sort((a, b) => {
    const order = { exact: 0, stem: 1, edit1: 2 } as const;
    if (order[a.matchType] !== order[b.matchType]) return order[a.matchType] - order[b.matchType];
    if (a.sameGroup !== b.sameGroup) return a.sameGroup ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return out;
}

export function describeNameMatch(
  m: NameDuplicateMatch,
  opts: { groupLabel?: string; groupless?: boolean } = {},
): string {
  const groupLabel = opts.groupLabel ?? "category";
  const codeStr = m.code ? ` (${m.code})` : "";
  let where = "";
  if (!opts.groupless) {
    where = m.groupName ? ` in ${groupLabel} "${m.groupName}"` : ` (uncategorized)`;
  }
  if (m.matchType === "exact") return `"${m.name}"${codeStr} already exists${where}`;
  if (m.matchType === "stem") return `looks like the same as "${m.name}"${codeStr}${where} (singular/plural form)`;
  return `differs by 1 letter from "${m.name}"${codeStr}${where}`;
}

export function shouldBlockNameDuplicates(
  matches: NameDuplicateMatch[],
  confirmDuplicate: boolean,
  confirmSimilar: boolean,
  opts: { groupless?: boolean } = {},
): { blocked: NameDuplicateMatch[]; reason: "exact" | "similar" } | null {
  if (!opts.groupless) {
    const exactSame = matches.filter(m => m.matchType === "exact" && m.sameGroup);
    if (exactSame.length > 0) return { blocked: exactSame, reason: "exact" };
  }
  const exactCross = matches.filter(m => m.matchType === "exact" && (opts.groupless ? true : !m.sameGroup));
  if (exactCross.length > 0 && !confirmDuplicate) return { blocked: exactCross, reason: "exact" };
  const similar = matches.filter(m => m.matchType !== "exact");
  if (similar.length > 0 && !confirmSimilar) return { blocked: similar, reason: "similar" };
  return null;
}

export function buildDupeErrorPayload(
  reason: "exact" | "similar",
  matches: NameDuplicateMatch[],
  opts: { entity: string; groupLabel?: string; groupless?: boolean },
) {
  const isExact = reason === "exact";
  const sameGroup = !opts.groupless && matches.some(m => m.sameGroup && m.matchType === "exact");
  const groupLabel = opts.groupLabel ?? "category";
  const lead = sameGroup
    ? `A ${opts.entity} with this name already exists in the same ${groupLabel}.`
    : isExact
      ? opts.groupless
        ? `A ${opts.entity} with this name already exists.`
        : `A ${opts.entity} with this name already exists in another ${groupLabel}.`
      : `Possible duplicate of an existing ${opts.entity}.`;
  const detail = matches.slice(0, 5).map(m => describeNameMatch(m, opts)).join("; ");
  return {
    error: `${lead} ${detail}.`,
    duplicateKind: reason,
    canConfirm: !sameGroup,
    duplicates: matches.map(m => ({
      id: m.id,
      name: m.name,
      code: m.code,
      groupKey: m.groupKey,
      groupName: m.groupName,
      matchType: m.matchType,
      sameGroup: m.sameGroup,
      // Backward-compat alias used by the existing ingredients front-end.
      categoryName: m.groupName,
    })),
  };
}
