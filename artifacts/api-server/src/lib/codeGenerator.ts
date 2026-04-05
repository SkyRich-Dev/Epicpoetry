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
};

export async function generateCode(prefix: string, table: string): Promise<string> {
  const codeCol = CODE_COLUMN[table] || "code";
  const prefixLen = prefix.length;

  const result = await db.execute(
    sql.raw(`SELECT COALESCE(MAX(CAST(SUBSTRING("${codeCol}" FROM ${prefixLen + 1}) AS INTEGER)), 0) AS max_num FROM ${table} WHERE "${codeCol}" LIKE '${prefix}%' AND SUBSTRING("${codeCol}" FROM ${prefixLen + 1}) ~ '^[0-9]+$'`)
  );
  const maxNum = Number((result.rows[0] as any).max_num) || 0;
  return `${prefix}${String(maxNum + 1).padStart(4, "0")}`;
}
