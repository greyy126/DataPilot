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
  columns: string[];
  dtypes: Record<string, string>;
  null_count: Record<string, number>;
  null_percentage: Record<string, number>;
  unique_count: Record<string, number>;
  duplicate_row_count: number;
  sample_rows: Record<string, unknown>[];
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

export type SuggestionItem = {
  action: string;
  column: string;
  reason: string;
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
  actions: Record<string, unknown>[]
): Promise<CleanResponse> {
  const root = requireBaseUrl();
  const res = await fetch(`${root}/clean`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file_id: fileId, actions }),
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
