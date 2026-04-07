const baseUrl = (): string => {
  const url = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";
  return url.replace(/\/$/, "");
};

function requireBaseUrl(): string {
  const root = baseUrl();
  if (!root) {
    throw new Error(
      "NEXT_PUBLIC_API_BASE_URL is not set. Add it to .env.local (e.g. http://127.0.0.1:8000)."
    );
  }
  return root;
}

export type UploadResponse = {
  file_id: string;
  file_path: string;
};

/** Matches GET /profile response */
export type ProfileResponse = {
  file_id: string;
  file_path: string;
  total_row_count: number;
  columns: string[];
  dtypes: Record<string, string>;
  null_count: Record<string, number>;
  null_percentage: Record<string, number>;
  unique_count: Record<string, number>;
  duplicate_row_count: number;
  sample_rows: Record<string, unknown>[];
};

export type ValidationRecommendation = {
  action:
    | "fill_missing"
    | "drop_rows"
    | "drop_column"
    | "clip_to_range"
    | "review"
    | "remove_duplicates";
  reason: string;
  fill_value?: unknown;
  fill_strategy?: string;
};

export type ValidationFinding = {
  rule_type: "null_check" | "range_check" | "type_check";
  severity: "info" | "warning" | "error";
  column: string;
  issue_type?:
    | "negative_values"
    | "extreme_values"
    | "domain_check"
    | "type_mismatch"
    | "category_mapping"
    | "duplicate_key"
    | "invalid_date"
    | null;
  issue_count: number;
  issue_percentage: number;
  affected_row_indices: number[];
  sample_row_indices: number[];
  range_value_type?: "numeric" | "date" | null;
  expected_min?: unknown;
  expected_max?: unknown;
  expected_range?: string | null;
  sample_values: unknown[];
  groups: Array<{
    canonical: string;
    variants: string[];
    count?: number | null;
  }>;
  message: string;
  recommendations: ValidationRecommendation[];
};

export type ValidationResponse = {
  file_id: string;
  message?: string | null;
  findings: ValidationFinding[];
};

function errorMessageFromBody(data: unknown): string {
  if (!data || typeof data !== "object") return "Request failed";
  const detail = (data as { detail?: unknown }).detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    return detail
      .map((item) => {
        if (item && typeof item === "object" && "msg" in item) {
          return String((item as { msg: string }).msg);
        }
        return JSON.stringify(item);
      })
      .join("; ");
  }
  return "Request failed";
}

/**
 * POST /upload — multipart file upload.
 */
export async function uploadFile(file: File): Promise<UploadResponse> {
  const root = requireBaseUrl();

  const form = new FormData();
  form.append("file", file);

  const res = await fetch(`${root}/upload`, {
    method: "POST",
    body: form,
  });

  if (!res.ok) {
    let msg = res.statusText || "Upload failed";
    try {
      msg = errorMessageFromBody(await res.json());
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }

  return res.json() as Promise<UploadResponse>;
}

/**
 * GET /profile?file_id=…
 */
export async function getProfile(fileId: string): Promise<ProfileResponse> {
  const root = requireBaseUrl();
  const url = new URL(`${root}/profile`);
  url.searchParams.set("file_id", fileId);

  const res = await fetch(url.toString());

  if (!res.ok) {
    let msg = res.statusText || "Failed to load profile";
    try {
      msg = errorMessageFromBody(await res.json());
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }

  return res.json() as Promise<ProfileResponse>;
}

/**
 * GET /validations?file_id=…
 */
export async function getValidations(
  fileId: string
): Promise<ValidationResponse> {
  const root = requireBaseUrl();
  const url = new URL(`${root}/validations`);
  url.searchParams.set("file_id", fileId);

  const res = await fetch(url.toString());

  if (!res.ok) {
    let msg = res.statusText || "Failed to load validations";
    try {
      msg = errorMessageFromBody(await res.json());
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }

  return res.json() as Promise<ValidationResponse>;
}

export type SuggestionItem = {
  action: string;
  column: string;
  reason: string;
  groups?: Array<{
    canonical: string;
    variants: string[];
    count: number;
  }>;
  mapping_groups?: Array<{
    from: string[];
    to: string;
  }>;
};

export type SuggestionsResponse = {
  file_id: string;
  suggestions: SuggestionItem[];
};

/**
 * GET /suggestions?file_id=…
 */
export async function getSuggestions(
  fileId: string
): Promise<SuggestionsResponse> {
  const root = requireBaseUrl();
  const url = new URL(`${root}/suggestions`);
  url.searchParams.set("file_id", fileId);

  const res = await fetch(url.toString());

  if (!res.ok) {
    let msg = res.statusText || "Failed to load suggestions";
    try {
      msg = errorMessageFromBody(await res.json());
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }

  return res.json() as Promise<SuggestionsResponse>;
}

export type CleanResponse = {
  cleaned_file_id: string;
  cleaned_file_path: string;
};

/**
 * POST /clean — apply approved actions.
 */
export async function postClean(
  fileId: string,
  actions: Record<string, unknown>[],
  selectedColumns?: string[]
): Promise<CleanResponse> {
  const root = requireBaseUrl();
  const res = await fetch(`${root}/clean`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      file_id: fileId,
      actions,
      selected_columns: selectedColumns,
    }),
  });

  if (!res.ok) {
    let msg = res.statusText || "Cleaning failed";
    try {
      msg = errorMessageFromBody(await res.json());
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }

  return res.json() as Promise<CleanResponse>;
}

/**
 * GET /download?file_id=… — returns cleaned file blob.
 */
export async function downloadCleanedFile(fileId: string): Promise<Blob> {
  const root = requireBaseUrl();
  const url = new URL(`${root}/download`);
  url.searchParams.set("file_id", fileId);

  const res = await fetch(url.toString());
  if (!res.ok) {
    let msg = res.statusText || "Download failed";
    try {
      msg = errorMessageFromBody(await res.json());
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }

  return res.blob();
}
