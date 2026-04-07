import type {
  ProfileResponse,
  SuggestionItem,
  ValidationFinding,
} from "@/services/api";

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
  return "Unknown";
}

function fillValueFromValidation(
  validation: ValidationFinding | undefined,
  profile: ProfileResponse,
  column: string
): string | number | boolean {
  const fillRecommendation = validation?.recommendations.find(
    (recommendation) => recommendation.action === "fill_missing"
  );
  if (fillRecommendation?.fill_value !== undefined) {
    return fillRecommendation.fill_value as string | number | boolean;
  }
  return fillValueForMissing(profile, column);
}

export function fillStrategyLabel(
  validation: ValidationFinding | undefined,
  profile: ProfileResponse,
  column: string
): string {
  const fillRecommendation = validation?.recommendations.find(
    (recommendation) => recommendation.action === "fill_missing"
  );
  if (fillRecommendation?.fill_strategy) {
    return fillRecommendation.fill_strategy;
  }

  const dt = profile.dtypes[column] ?? "";
  if (dt.includes("int") || dt.includes("float")) {
    return "default_numeric";
  }
  if (dt === "bool" || dt === "boolean") {
    return "mode";
  }
  return "default_text";
}

/**
 * Maps one API suggestion to a POST /clean action object.
 * remove_duplicates omits `column` so the backend defaults to all columns.
 * standardize_date sends { action, column } (same shape as convert_to_date).
 */
export function mapSuggestionToCleanAction(
  suggestion: SuggestionItem,
  profile: ProfileResponse,
  validation?: ValidationFinding,
  selectedStrategy?: "fill_missing" | "drop_rows" | "drop_column",
  selectedRowNumbers?: number[],
  categoryMappingTargets?: string[],
  customFillValue?: string
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
      return column === "*"
        ? { action: "remove_duplicates" }
        : { action: "remove_duplicates", column };
    case "trim_whitespace":
    case "normalize_case":
    case "convert_to_date":
    case "convert_to_numeric":
    case "standardize_date":
      return { action, column };
    case "standardize_values":
      if (!suggestion.mapping_groups || suggestion.mapping_groups.length === 0) {
        throw new Error(`No value mappings are available for ${column}`);
      }
      return {
        action: "standardize_values",
        column,
        groups: suggestion.mapping_groups.map((group, index) => ({
          from: group.from,
          to: (() => {
            const target = categoryMappingTargets?.[index];
            return target && target.trim() !== "" ? target : group.to;
          })(),
        })),
      };
    case "fill_missing":
      if (selectedStrategy === "drop_rows") {
        if (!selectedRowNumbers || selectedRowNumbers.length === 0) {
          throw new Error(`Choose at least one row number to drop for ${column}`);
        }
        return {
          action: "drop_rows",
          column,
          row_numbers: selectedRowNumbers,
        };
      }
      if (selectedStrategy === "drop_column") {
        return {
          action: "drop_column",
          column,
        };
      }
      return {
        action: "fill_missing",
        column,
        fill_value:
          customFillValue !== undefined
            ? customFillValue
            : fillValueFromValidation(validation, profile, column),
      };
    default:
      throw new Error(
        `Cannot map unknown suggestion action "${action}" to a clean payload`
      );
  }
}

export function mapValidationFindingToCleanAction(
  finding: ValidationFinding,
  selectedStrategy: "drop_rows" | "clip_to_range",
  selectedRowNumbers?: number[]
): Record<string, unknown> {
  if (!selectedRowNumbers || selectedRowNumbers.length === 0) {
    throw new Error(`Choose at least one row number for ${finding.column}`);
  }

  if (selectedStrategy === "drop_rows") {
    return {
      action: "drop_rows",
      column: finding.column,
      row_numbers: selectedRowNumbers,
    };
  }

  if (selectedStrategy === "clip_to_range") {
    if (finding.range_value_type !== "numeric") {
      throw new Error(`clip_to_range is only available for numeric validations on ${finding.column}`);
    }
    if (finding.expected_min === undefined && finding.expected_max === undefined) {
      throw new Error(`No numeric range is available for ${finding.column}`);
    }
    return {
      action: "clip_to_range",
      column: finding.column,
      row_numbers: selectedRowNumbers,
      min_value:
        typeof finding.expected_min === "number" ? finding.expected_min : undefined,
      max_value:
        typeof finding.expected_max === "number" ? finding.expected_max : undefined,
    };
  }

  throw new Error(`Unsupported validation strategy ${selectedStrategy}`);
}

export function mapTypeMismatchToCleanAction(
  finding: ValidationFinding,
  selectedStrategy: "convert_numeric" | "drop_rows" | "replace",
  selectedRowNumbers?: number[],
  replacementValue?: string
): Record<string, unknown> {
  if (selectedStrategy === "convert_numeric") {
    return {
      action: "convert_numeric",
      column: finding.column,
    };
  }

  if (selectedStrategy === "drop_rows") {
    if (!selectedRowNumbers || selectedRowNumbers.length === 0) {
      throw new Error(`Choose at least one row number for ${finding.column}`);
    }
    return {
      action: "drop_rows",
      column: finding.column,
      row_numbers: selectedRowNumbers,
    };
  }

  if (selectedStrategy === "replace") {
    if (replacementValue === undefined || replacementValue === "") {
      throw new Error(`Enter a replacement value for ${finding.column}`);
    }
    return {
      action: "replace",
      column: finding.column,
      value: replacementValue,
    };
  }

  throw new Error(`Unsupported type mismatch strategy ${selectedStrategy}`);
}

/** Lower runs earlier among non-rename actions. */
function executionPriority(action: string): number {
  switch (action) {
    case "trim_whitespace":
      return 0;
    case "standardize_values":
      return 1;
    case "normalize_case":
      return 2;
    case "convert_to_date":
    case "convert_to_numeric":
    case "convert_numeric":
    case "standardize_date":
    case "fill_missing":
    case "drop_rows":
    case "clip_to_range":
    case "drop_column":
    case "replace":
      return 3;
    case "remove_duplicates":
      return 4;
    default:
      return 5;
  }
}

/**
 * Reorders clean payloads so the backend runs steps safely.
 *
 * rename_column must run last because it changes column names used by other actions
 * (e.g. trim_whitespace must run on the original column name first).
 *
 * Among non-rename steps: normalize/repair values first, then remove duplicates,
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

export function normalizeRowTargetActions(
  actions: Record<string, unknown>[]
): Record<string, unknown>[] {
  const droppedRows = new Set<number>();
  const normalized: Record<string, unknown>[] = [];

  for (const action of actions) {
    const actionName = String(action.action ?? "");

    if (actionName === "drop_rows") {
      const rowNumbers = Array.isArray(action.row_numbers)
        ? action.row_numbers
            .map((value) => Number(value))
            .filter((value) => Number.isInteger(value) && value >= 2)
        : [];
      const remainingRows = rowNumbers.filter((row) => !droppedRows.has(row));
      if (remainingRows.length === 0) {
        continue;
      }
      remainingRows.forEach((row) => droppedRows.add(row));
      normalized.push({
        ...action,
        row_numbers: remainingRows,
      });
      continue;
    }

    if (actionName === "clip_to_range") {
      const rowNumbers = Array.isArray(action.row_numbers)
        ? action.row_numbers
            .map((value) => Number(value))
            .filter((value) => Number.isInteger(value) && value >= 2)
        : [];
      const remainingRows = rowNumbers.filter((row) => !droppedRows.has(row));
      if (rowNumbers.length > 0 && remainingRows.length === 0) {
        continue;
      }
      normalized.push({
        ...action,
        row_numbers: rowNumbers.length > 0 ? remainingRows : rowNumbers,
      });
      continue;
    }

    normalized.push(action);
  }

  return normalized;
}
