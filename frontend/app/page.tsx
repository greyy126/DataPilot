"use client";

import { useState } from "react";
import {
  getProfile,
  getSuggestions,
  downloadCleanedFile,
  postClean,
  uploadFile,
  type ProfileResponse,
  type CleanResponse,
  type SuggestionItem,
} from "@/services/api";
import {
  mapSuggestionToCleanAction,
  orderCleanActionsForPipeline,
} from "@/lib/mapSuggestionsToClean";

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export default function HomePage() {
  const [fileId, setFileId] = useState<string | null>(null);
  const [profile, setProfile] = useState<ProfileResponse | null>(null);
  const [uploadStatus, setUploadStatus] = useState<
    "idle" | "uploading" | "error"
  >("idle");
  const [isUploading, setIsUploading] = useState(false);
  const [profileLoading, setProfileLoading] = useState(false);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [cleanLoading, setCleanLoading] = useState(false);
  const [downloadLoading, setDownloadLoading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [suggestionsError, setSuggestionsError] = useState<string | null>(null);
  const [cleanError, setCleanError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<SuggestionItem[]>([]);
  /** `true` = user approved this suggestion for apply */
  const [approved, setApproved] = useState<boolean[]>([]);
  const [cleanResult, setCleanResult] = useState<CleanResponse | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  function resetDataState() {
    setFileId(null);
    setProfile(null);
    setProfileError(null);
    setProfileLoading(false);
    setSuggestionsLoading(false);
    setSuggestions([]);
    setApproved([]);
    setSuggestionsError(null);
    setCleanError(null);
    setCleanResult(null);
    setDownloadLoading(false);
    setIsUploading(false);
    setCleanLoading(false);
  }

  async function handleUpload() {
    if (!selectedFile) {
      setUploadError("Choose a CSV or Excel file first.");
      setUploadStatus("error");
      return;
    }
    setIsUploading(true);
    setUploadError(null);
    setProfileError(null);
    setSuggestionsError(null);
    setCleanError(null);
    setCleanResult(null);
    setProfile(null);
    setSuggestions([]);
    setApproved([]);
    setFileId(null);
    setUploadStatus("uploading");

    try {
      const data = await uploadFile(selectedFile);
      setFileId(data.file_id);
      setUploadStatus("idle");

      setProfileLoading(true);
      try {
        const p = await getProfile(data.file_id);
        setProfile(p);
        setProfileError(null);
      } catch (e) {
        setProfile(null);
        setProfileError(
          e instanceof Error ? e.message : "Failed to load profile"
        );
        setProfileLoading(false);
        return;
      } finally {
        setProfileLoading(false);
      }

      setSuggestionsLoading(true);
      try {
        const sg = await getSuggestions(data.file_id);
        setSuggestions(sg.suggestions);
        setApproved(sg.suggestions.map(() => true));
        setSuggestionsError(null);
      } catch (e) {
        setSuggestions([]);
        setApproved([]);
        setSuggestionsError(
          e instanceof Error ? e.message : "Failed to load suggestions"
        );
      } finally {
        setSuggestionsLoading(false);
      }
    } catch (e) {
      setFileId(null);
      setProfile(null);
      setSuggestions([]);
      setApproved([]);
      setUploadStatus("error");
      setUploadError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setIsUploading(false);
    }
  }

  async function handleApplyApproved() {
    if (!fileId || !profile) {
      setCleanError("Nothing to apply.");
      return;
    }
    setCleanError(null);
    setCleanResult(null);
    setCleanLoading(true);
    try {
      const approvedActions: Record<string, unknown>[] = [];
      for (let i = 0; i < suggestions.length; i++) {
        if (!approved[i]) continue;
        approvedActions.push(
          mapSuggestionToCleanAction(suggestions[i], profile)
        );
      }
      const finalActions = orderCleanActionsForPipeline(approvedActions);
      const result = await postClean(fileId, finalActions);
      setCleanResult(result);
    } catch (e) {
      setCleanResult(null);
      setCleanError(
        e instanceof Error ? e.message : "Cleaning failed"
      );
    } finally {
      setCleanLoading(false);
    }
  }

  async function handleDownload() {
    if (!cleanResult) return;
    setCleanError(null);
    setDownloadLoading(true);
    try {
      const blob = await downloadCleanedFile(cleanResult.cleaned_file_id);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "cleaned_data.csv";
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (e) {
      setCleanError(e instanceof Error ? e.message : "Download failed");
    } finally {
      setDownloadLoading(false);
    }
  }

  const isCleaning = cleanLoading;

  return (
    <>
      <h1>Data Collector</h1>

      <section className="section" aria-labelledby="upload-heading">
        <h2 id="upload-heading">Upload file</h2>
        <div className="upload-row">
          <input
            type="file"
            accept=".csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              setSelectedFile(f);
              resetDataState();
              setUploadStatus("idle");
              setUploadError(null);
            }}
          />
          <button
            type="button"
            onClick={handleUpload}
            disabled={isUploading || !selectedFile}
          >
            {isUploading
              ? "Uploading…"
              : profileLoading
                ? "Loading profile…"
                : suggestionsLoading
                  ? "Loading suggestions…"
                  : "Upload"}
          </button>
        </div>
      </section>

      {uploadStatus === "error" && uploadError && (
        <p className="message error" role="alert">
          {uploadError}
        </p>
      )}

      {fileId && uploadStatus !== "error" && (
        <p className="message success" role="status">
          Upload succeeded. File id: <code>{fileId}</code>
        </p>
      )}

      {profileLoading && (
        <p className="loading-inline" aria-live="polite">
          Loading dataset profile…
        </p>
      )}

      {profileError && (
        <p className="message error" role="alert">
          Profile could not be loaded: {profileError}
        </p>
      )}

      {suggestionsLoading && !profileLoading && (
        <p className="loading-inline" aria-live="polite">
          Loading cleaning suggestions…
        </p>
      )}

      {suggestionsError && (
        <p className="message error" role="alert">
          Suggestions could not be loaded: {suggestionsError}
        </p>
      )}

      {profile && !profileLoading && (
        <>
          <section className="preview" aria-labelledby="preview-heading">
            <h2 id="preview-heading">Data preview</h2>
            <p style={{ fontSize: "0.9rem", marginTop: 0 }}>
              Sample rows (up to 5) — {profile.columns.length} column
              {profile.columns.length === 1 ? "" : "s"}.
            </p>
            <div style={{ overflowX: "auto" }}>
              <table className="data-preview">
                <thead>
                  <tr>
                    {profile.columns.map((col) => (
                      <th key={col}>{col}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {profile.sample_rows.length === 0 ? (
                    <tr>
                      <td
                        colSpan={Math.max(profile.columns.length, 1)}
                        className="empty"
                      >
                        No rows in sample.
                      </td>
                    </tr>
                  ) : (
                    profile.sample_rows.map((row, i) => (
                      <tr key={i}>
                        {profile.columns.map((col) => {
                          const v = row[col];
                          const text = formatCell(v);
                          return (
                            <td
                              key={col}
                              className={text === "" ? "empty" : undefined}
                            >
                              {text === "" ? "—" : text}
                            </td>
                          );
                        })}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="preview" aria-labelledby="profile-heading">
            <h2 id="profile-heading">Profiling summary</h2>
            <ul className="summary-list">
              <li>
                <strong>Total columns:</strong> {profile.columns.length}
              </li>
              <li>
                <strong>Duplicate rows:</strong> {profile.duplicate_row_count}
              </li>
              <li>
                <strong>Null counts by column:</strong>
                <ul>
                  {profile.columns.map((col) => (
                    <li key={col}>
                      {col}: {profile.null_count[col] ?? 0}
                    </li>
                  ))}
                </ul>
              </li>
            </ul>
          </section>

          {!suggestionsLoading && !suggestionsError && (
            <section
              className="preview"
              aria-labelledby="suggestions-heading"
            >
              <h2 id="suggestions-heading">Cleaning suggestions</h2>
              {suggestions.length === 0 ? (
                <p style={{ fontSize: "0.95rem" }}>No suggestions.</p>
              ) : (
                <>
                  <ul className="suggestion-list">
                    {suggestions.map((s, i) => (
                      <li key={i} className="suggestion-item">
                        <label
                          style={{
                            display: "flex",
                            gap: "0.75rem",
                            alignItems: "flex-start",
                            cursor: "pointer",
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={approved[i] ?? false}
                            onChange={(e) => {
                              const next = [...approved];
                              next[i] = e.target.checked;
                              setApproved(next);
                            }}
                            aria-label={`Approve ${s.action} on ${s.column}`}
                          />
                          <span>
                            <strong>{s.action}</strong>
                            {s.column !== "*" && (
                              <>
                                {" "}
                                — column: <code>{s.column}</code>
                              </>
                            )}
                            {s.column === "*" && (
                              <> — entire dataset</>
                            )}
                            <br />
                            <span style={{ color: "#444" }}>{s.reason}</span>
                          </span>
                        </label>
                      </li>
                    ))}
                  </ul>
                  <div style={{ marginTop: "1rem" }}>
                    <button
                      type="button"
                      onClick={handleApplyApproved}
                      disabled={
                        cleanLoading ||
                        !fileId ||
                        !profile ||
                        suggestions.length === 0 ||
                        !approved.some(Boolean)
                      }
                    >
                      {cleanLoading ? "Applying…" : "Apply approved actions"}
                    </button>
                    {cleanLoading && (
                      <p className="loading-inline" aria-live="polite">
                        Cleaning in progress...
                      </p>
                    )}
                  </div>
                </>
              )}
            </section>
          )}

          {cleanError && (
            <p className="message error" role="alert">
              {cleanError}
            </p>
          )}

          {cleanResult && (
            <section className="preview" aria-labelledby="cleaned-heading">
              <h2 id="cleaned-heading">Cleaned data</h2>
              <p className="message success" role="status">
                Data cleaned successfully. Cleaned file id:{" "}
                <code>{cleanResult.cleaned_file_id}</code>
              </p>
              <div
                style={{
                  display: "flex",
                  gap: "0.75rem",
                  alignItems: "center",
                  flexWrap: "wrap",
                }}
              >
                <button
                  type="button"
                  onClick={handleDownload}
                  disabled={downloadLoading}
                >
                  {downloadLoading ? "Preparing download…" : "Download cleaned CSV"}
                </button>
                {downloadLoading && (
                  <span className="loading-inline" aria-live="polite">
                    Downloading cleaned file...
                  </span>
                )}
              </div>
              <p className="hint" style={{ marginTop: "0.5rem" }}>
                Saved at: <code>{cleanResult.cleaned_file_path}</code>
              </p>
            </section>
          )}
        </>
      )}

      <p className="hint">
        Set <code>NEXT_PUBLIC_API_BASE_URL</code> in <code>.env.local</code> to your
        FastAPI server (e.g. <code>http://127.0.0.1:8000</code>).
      </p>
    </>
  );
}
