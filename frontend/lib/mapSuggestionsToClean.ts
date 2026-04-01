import type { ProfileResponse, SuggestionItem } from "@/services/api";

/**
 * Deterministic snake_case-style name for rename_column (spaces → underscores).
 */
export function suggestedNewName(column: string): string {
  return column.trim().replace(/\s+/g, "_");
}

function fillValueForMissing(
  profile: ProfileResponse,
  column: string
): string | number | boolean {
  const dt = profile.dtypes[column] ?? "";
  if (dt === "bool" || dt === "boolean") {
    return false;
  }
  if (dt.includes("int") || dt.includes("float")) {
    return 0;
  }
  return "";
}

/**
 * Maps one API suggestion to a POST /clean action object.
 * remove_duplicates omits `column` so the backend defaults to all columns.
 * standardize_date sends { action, column } (same shape as convert_to_date).
 */
export function mapSuggestionToCleanAction(
  suggestion: SuggestionItem,
  profile: ProfileResponse
): Record<string, unknown> {
  const { action, column } = suggestion;

  switch (action) {
    case "rename_column":
      return {
        action: "rename_column",
        column,
        new_name: suggestedNewName(column),
      };
    case "remove_duplicates":
      return { action: "remove_duplicates" };
    case "trim_whitespace":
    case "normalize_case":
    case "convert_to_date":
    case "convert_to_numeric":
    case "standardize_date":
      return { action, column };
    case "fill_missing":
      return {
        action: "fill_missing",
        column,
        fill_value: fillValueForMissing(profile, column),
      };
    default:
      throw new Error(
        `Cannot map unknown suggestion action "${action}" to a clean payload`
      );
  }
}

/** Lower runs earlier among non-rename actions (trim before dedupe before the rest). */
function executionPriority(action: string): number {
  switch (action) {
    case "trim_whitespace":
      return 0;
    case "remove_duplicates":
      return 1;
    default:
      return 2;
  }
}

/**
 * Reorders clean payloads so the backend runs steps safely.
 *
 * rename_column must run last because it changes column names used by other actions
 * (e.g. trim_whitespace must run on the original column name first).
 *
 * Among non-rename steps: trim_whitespace → remove_duplicates → everything else,
 * preserving original order within the same priority.
 */
export function orderCleanActionsForPipeline(
  actions: Record<string, unknown>[]
): Record<string, unknown>[] {
  const renameActions = actions.filter(
    (a) => a.action === "rename_column"
  );
  const otherActions = actions.filter(
    (a) => a.action !== "rename_column"
  );

  const indexed = otherActions.map((payload, index) => ({
    payload,
    index,
  }));
  indexed.sort((a, b) => {
    const pa = executionPriority(String(a.payload.action));
    const pb = executionPriority(String(b.payload.action));
    if (pa !== pb) return pa - pb;
    return a.index - b.index;
  });

  const sortedOther = indexed.map((x) => x.payload);

  return [...sortedOther, ...renameActions];
}
