import {
  findNameDuplicates,
  describeNameMatch,
  normalizeName as _normalizeName,
  normalizeStem as _normalizeStem,
  editDistanceLeq as _editDistanceLeq,
  type NameRecord,
  type NameDuplicateMatch,
  type MatchType as _MatchType,
} from "./nameDedupe";

export type MatchType = _MatchType;

export type IngredientLite = {
  id: number;
  code: string;
  name: string;
  categoryId: number | null;
  categoryName?: string | null;
};

export type DuplicateMatch = {
  id: number;
  code: string;
  name: string;
  categoryId: number | null;
  categoryName: string | null;
  matchType: MatchType;
  sameCategory: boolean;
};

export const normalizeName = _normalizeName;
export const normalizeStem = _normalizeStem;
export const editDistanceLeq = _editDistanceLeq;

function toNameRecord(i: IngredientLite): NameRecord {
  return { id: i.id, name: i.name, code: i.code, groupKey: i.categoryId, groupName: i.categoryName ?? null };
}

function fromNameMatch(m: NameDuplicateMatch): DuplicateMatch {
  return {
    id: m.id,
    code: m.code ?? "",
    name: m.name,
    categoryId: typeof m.groupKey === "number" ? m.groupKey : m.groupKey == null ? null : Number(m.groupKey),
    categoryName: m.groupName ?? null,
    matchType: m.matchType,
    sameCategory: m.sameGroup,
  };
}

export function findDuplicates(
  name: string,
  categoryId: number | null,
  pool: IngredientLite[],
  excludeId?: number,
): DuplicateMatch[] {
  const matches = findNameDuplicates(name, categoryId, pool.map(toNameRecord), excludeId);
  return matches.map(fromNameMatch);
}

export function describeMatch(m: DuplicateMatch): string {
  const cat = m.categoryName ? `category "${m.categoryName}"` : "uncategorized";
  if (m.matchType === "exact") return `"${m.name}" (${m.code}) already exists in ${cat}`;
  if (m.matchType === "stem") return `looks like the same as "${m.name}" (${m.code}) in ${cat} (singular/plural form)`;
  return `differs by 1 letter from "${m.name}" (${m.code}) in ${cat}`;
}
