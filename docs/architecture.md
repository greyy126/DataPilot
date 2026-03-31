# Data Collector — System Architecture

MVP: rule-based cleaning only. Local files + SQLite. No external APIs, no background queues, no authentication.

---

## 1. High-level architecture

### Frontend ↔ backend

- The **Next.js** app talks to **FastAPI** over **HTTP** (same machine in dev; reverse proxy or direct URL in production).
- JSON is used for metadata (profile, suggestions, workflow records). **File upload** uses `multipart/form-data`; **download** uses file responses or signed paths returned by the API.
- No server-to-server calls outside this pair.

### Backend processing

- FastAPI receives uploads, writes files under **`storage/`**, loads them with **Pandas** for profile, suggestions, and cleaning.
- All transforms run **in the request** (synchronous): load → compute → write result → return. No job queue.

### Where files live

| Path (example) | Purpose |
|----------------|---------|
| `storage/uploads/{session_or_id}/` | Original uploaded CSV/Excel |
| `storage/cleaned/{session_or_id}/` | Exported cleaned CSV after apply |

Paths are **local filesystem only**; the API returns identifiers so the client can request profile/suggestions/clean/download without passing raw paths from the browser.

### SQLite usage

- **Workflows**: name, optional description, ordered list of approved rule steps (JSON), link to source file id / timestamps.
- **Session or file registry** (minimal): map `file_id` → stored path, format, created time—so APIs stay stateless aside from DB + disk.

### Data flow (step-by-step)

1. **Upload** — Client sends file → API saves to `storage/uploads/…`, creates DB row → returns `file_id`.
2. **Profile** — Client requests profile for `file_id` → API loads DataFrame → **profiling_service** computes stats → JSON response.
3. **Suggestions** — Client requests suggestions for `file_id` → **suggestion_engine** reads profile (+ optional column samples) → returns list of proposed rules (no apply).
4. **Approve** — User selects rules in UI; client sends **approved rule definitions** (or indices referencing server-side rule catalog) with `file_id`.
5. **Clean** — **cleaning_service** loads file, applies approved rules with Pandas, writes `storage/cleaned/…` → returns `cleaned_file_id` or download URL path token.
6. **Export** — Client requests download for cleaned artifact by id.
7. **Save workflow** — Client POSTs workflow payload (rules + metadata) → **workflow_service** persists to SQLite.

---

## 2. Backend architecture (modules)

```
backend/
  api/           # Route handlers only: parse, validate, call services, return responses
  services/      # profiling_service, suggestion_engine, cleaning_service, workflow_service
  models/        # Pydantic schemas (requests/responses), domain types for rules/workflows
  db/            # SQLite connection, migrations or init script, repository helpers
  utils/         # File helpers, safe paths, CSV/Excel load wrappers
```

- **`api/`** — Thin HTTP layer; no business logic beyond validation.
- **`services/profiling_service`** — Nulls, duplicates, dtypes, uniques, simple summaries.
- **`services/suggestion_engine`** — Rule-based proposals from profiling output only.
- **`services/cleaning_service`** — Applies approved rules to a DataFrame and writes CSV.
- **`services/workflow_service`** — CRUD for saved workflows in SQLite.
- **File handling** — Upload validation (extension, size), save under `storage/`, delete/replace policy as needed for MVP.

---

## 3. Frontend architecture

Simple, functional UI—no design system requirement.

| Area | Role |
|------|------|
| **Upload page** | Form: choose CSV/XLSX → POST upload → store `file_id` (React state or URL query). |
| **Dataset preview** | Table component: first N rows from API or embedded preview endpoint. |
| **Profiling summary** | Cards or list: nulls, dupes, types, key uniques—driven by profile JSON. |
| **Suggestions panel** | List of suggested rules with **approve/reject** toggles; “Apply selected” sends approved set to clean endpoint. |
| **Download** | Button: GET export endpoint with `cleaned_file_id` (or blob response). |
| **Workflow save** | Optional form: name + save current approved rule list via workflow API. |

```
frontend/
  app/ or pages/     # Next.js routes: upload, dataset/[fileId], etc.
  components/        # UploadForm, DataPreviewTable, ProfileSummary, SuggestionsPanel, etc.
  services/          # api client: fetch wrappers for FastAPI base URL
```

---

## 4. Proposed folder structure

```
data-collector/
  docs/
    product_spec.md
    architecture.md
  frontend/
    app/                 # or pages/ if Pages Router
    components/
    services/
    public/
    package.json
    tsconfig.json
    next.config.js
  backend/
    api/
    services/
    models/
    db/
    utils/
    main.py              # FastAPI app entry, mount routers
    requirements.txt
  storage/
    uploads/
    cleaned/
  README.md
```

- **`storage/`** — Gitignored; created at runtime. Only local disk.
- **`docs/`** — Product and architecture docs.

---

## 5. Key backend services

| Service | Responsibility |
|---------|------------------|
| **`profiling_service`** | Load dataset from path, compute null counts per column, duplicate row count, dtypes, basic unique stats / cardinality signals needed for rules. Returns a structured profile object. |
| **`suggestion_engine`** | Input: profile (and fixed rule catalog). Output: list of **rule proposals** (e.g. “drop duplicate rows”, “fill nulls in column X with …”) with parameters. **Deterministic**: same profile → same suggestions. No learning. |
| **`cleaning_service`** | Input: `file_id`, ordered list of **approved** rule objects. Load DataFrame, apply each step with Pandas, validate, write cleaned CSV to `storage/cleaned/`, register in DB if needed. |
| **`workflow_service`** | Save/load/list/delete workflows in SQLite: metadata + serialized rule list for reuse or audit. |

---

## 6. API routes (minimal)

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/files/upload` | Multipart upload → save file, return `file_id` |
| `GET` | `/api/files/{file_id}/profile` | Run profiling → profile JSON |
| `GET` | `/api/files/{file_id}/suggestions` | Rule-based suggestions JSON |
| `POST` | `/api/files/{file_id}/clean` | Body: approved rules → apply cleaning → return `cleaned_file_id` (and/or path token) |
| `GET` | `/api/files/cleaned/{cleaned_file_id}/download` | Stream cleaned CSV |
| `POST` | `/api/workflows` | Save workflow (metadata + rules) |
| `GET` | `/api/workflows` | List workflows |
| `GET` | `/api/workflows/{workflow_id}` | Get one workflow |

Optional for preview without loading huge tables client-side:

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/files/{file_id}/preview?limit=…` | First N rows as JSON |

Naming can be shortened (e.g. `/upload`, `/profile/{id}`) as long as the responsibilities stay the same.

---

## 7. Constraints (strict)

| Constraint | Approach |
|------------|----------|
| No LLM / AI | Suggestions only from **suggestion_engine** rules + profiling. |
| No external APIs | FastAPI only; no HTTP clients to third parties for core flow. |
| No background jobs | All work in request handlers. |
| No authentication | Single-user local assumption; no auth middleware. |
| No cloud storage | `storage/` on disk only. |

---

*End of architecture overview.*
