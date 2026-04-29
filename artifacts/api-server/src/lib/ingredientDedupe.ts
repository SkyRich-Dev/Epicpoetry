export type IngredientLite = {
  id: number;
  code: string;
  name: string;
  categoryId: number | null;
  categoryName?: string | null;
};

export type MatchType = "exact" | "stem" | "edit1";

export type DuplicateMatch = {
  id: number;
  code: string;
  name: string;
  categoryId: number | null;
  categoryName: string | null;
  matchType: MatchType;
  sameCategory: boolean;
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

export function findDuplicates(
  name: string,
  categoryId: number | null,
  pool: IngredientLite[],
  excludeId?: number,
): DuplicateMatch[] {
  const targetNorm = normalizeName(name);
  if (!targetNorm) return [];
  const targetStem = normalizeStem(name);
  const out: DuplicateMatch[] = [];
  const seen = new Set<number>();
  for (const ing of pool) {
    if (excludeId != null && ing.id === excludeId) continue;
    if (seen.has(ing.id)) continue;
    const otherNorm = normalizeName(ing.name);
    if (!otherNorm) continue;
    let matchType: MatchType | null = null;
    if (otherNorm === targetNorm) matchType = "exact";
    else {
      const otherStem = normalizeStem(ing.name);
      if (otherStem === targetStem && otherStem.length > 0) matchType = "stem";
      else if (Math.min(targetNorm.length, otherNorm.length) >= 4 && editDistanceLeq(targetNorm, otherNorm, 1) <= 1) matchType = "edit1";
    }
    if (matchType) {
      seen.add(ing.id);
      out.push({
        id: ing.id,
        code: ing.code,
        name: ing.name,
        categoryId: ing.categoryId,
        categoryName: ing.categoryName ?? null,
        matchType,
        sameCategory: categoryId != null && ing.categoryId === categoryId,
      });
    }
  }
  out.sort((a, b) => {
    const order = { exact: 0, stem: 1, edit1: 2 } as const;
    if (order[a.matchType] !== order[b.matchType]) return order[a.matchType] - order[b.matchType];
    if (a.sameCategory !== b.sameCategory) return a.sameCategory ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return out;
}

export function describeMatch(m: DuplicateMatch): string {
  const cat = m.categoryName ? `category "${m.categoryName}"` : "uncategorized";
  if (m.matchType === "exact") return `"${m.name}" (${m.code}) already exists in ${cat}`;
  if (m.matchType === "stem") return `looks like the same as "${m.name}" (${m.code}) in ${cat} (singular/plural form)`;
  return `differs by 1 letter from "${m.name}" (${m.code}) in ${cat}`;
}
