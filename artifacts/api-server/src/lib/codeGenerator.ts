import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

const CODE_COLUMN: Record<string, string> = {
  trials: "trial_code",
  menu_items: "code",
  purchases: "purchase_number",
  expenses: "expense_number",
  vendors: "code",
  ingredients: "code",
  petty_cash: "reference_number",
  vendor_payments: "payment_no",
  employees: "code",
  waste_entries: "waste_number",
  // v2.0
  kot_orders: "kot_number",
  stocktakes: "stocktake_number",
  purchase_orders: "po_number",
};

// Anything with an .execute(sql) method (db or a drizzle transaction handle).
type Executor = { execute: (q: any) => Promise<any> };

/**
 * Generate the next code like "PP0001". Uses MAX+1 over existing codes.
 *
 * IMPORTANT: when called inside a transaction that has already inserted rows in the
 * same target table within the same call chain, you MUST pass the transaction handle
 * as the third argument. Otherwise the MAX query runs on a separate connection and
 * cannot see the in-flight inserts, producing duplicate codes that violate uniqueness.
 *
 * For cross-transaction concurrency (two separate transactions racing), the caller
 * should additionally hold a pg_advisory_xact_lock around the generate+insert pair.
 */
export async function generateCode(
  prefix: string,
  table: string,
  executor: Executor = db,
): Promise<string> {
  const codeCol = CODE_COLUMN[table] || "code";
  const prefixLen = prefix.length;

  const result = await executor.execute(
    sql.raw(`SELECT COALESCE(MAX(CAST(SUBSTRING("${codeCol}" FROM ${prefixLen + 1}) AS INTEGER)), 0) AS max_num FROM ${table} WHERE "${codeCol}" LIKE '${prefix}%' AND SUBSTRING("${codeCol}" FROM ${prefixLen + 1}) ~ '^[0-9]+$'`)
  );
  const maxNum = Number((result.rows[0] as any).max_num) || 0;
  return `${prefix}${String(maxNum + 1).padStart(4, "0")}`;
}
