# DataPilot — System Architecture

Current implementation: rule-based cleaning only. Local files + SQLite. No external APIs, no background queues, no authentication.

---

## 1. High-level architecture

### Frontend ↔ backend

- The **Next.js** frontend talks to the **FastAPI** backend over **HTTP**.
- JSON is used for metadata responses such as profile, validations, suggestions, and cleaning results.
- File upload uses `multipart/form-data`.
- Download uses a file response from the backend.
- No external network services are involved in the core flow.

### Backend processing

- FastAPI receives uploads and writes them under **`backend/storage/`**.
- The backend loads datasets with **Pandas** for profiling, validation, suggestions, and cleaning.
- All work runs synchronously in request handlers: load → compute → return or write output.

### Where files live

| Path | Purpose |
|------|---------|
| `backend/storage/uploads/{file_id}.{ext}` | Original uploaded CSV/Excel file |
| `backend/storage/cleaned/{cleaned_id}.csv` | Exported cleaned CSV |

Paths are local filesystem paths only. The frontend works with file identifiers and API responses rather than raw file paths from the browser.

### SQLite usage

- SQLite is initialized locally for app data.
- The current cleaning workflow is primarily file-based.
- Workflow save/load is described in older planning docs but is not wired into the current frontend flow.

### Data flow

1. **Upload**: Client sends file → API saves it under `backend/storage/uploads/` → returns `file_id`.
2. **Profile**: Client requests profile for `file_id` → `profiling_service` computes row counts, null counts, duplicate counts, dtypes, and sample rows.
3. **Validate**: Client requests validations for `file_id` → `validation_service` computes deterministic findings.
4. **Suggest**: Client requests suggestions for `file_id` → `suggestion_engine` uses profile + validation output to produce cleaning suggestions.
5. **Approve**: User selects strategies and actions in the frontend.
6. **Clean**: Client posts approved actions + selected columns → `cleaning_service` applies the pipeline and writes a cleaned CSV.
7. **Download**: Client requests the cleaned file by id.

### Frontend loading and navigation flow

- The app uses a **single-page workspace** with sections for upload, preview, profiling, columns, validation, and cleaning.
- Section access is progressively unlocked:
  - `Preview`, `Profiling`, and `Columns` unlock after profile data loads
  - `Validation` unlocks after validation findings load
  - `Cleaning` unlocks after suggestions load
- The UI shows staged loading states for:
  - uploading file
  - building dataset profile
  - running validation checks
  - preparing cleaning suggestions
- The frontend no longer parses full spreadsheet null-row maps in the browser; it relies on backend responses for dataset metadata.

---

## 2. Backend architecture

```text
backend/
  app/
    api/routes/   # Thin route handlers
    services/     # profiling_service, validation_service, suggestion_engine, cleaning_service
    models/       # Pydantic request/response schemas
    db/           # SQLite session/bootstrap
    utils/        # File handling and path helpers
    main.py       # FastAPI app entry
  requirements.txt
  storage/
    uploads/
    cleaned/
```

### Core backend services

| Service | Responsibility |
|---------|----------------|
| `profiling_service` | Compute row count, column list, dtypes, null counts, null percentages, unique counts, duplicate counts, and sample rows. |
| `validation_service` | Compute deterministic findings for nulls, numeric issues, type mismatches, invalid dates, duplicate keys, and category mappings. |
| `suggestion_engine` | Turn profile/validation results into deterministic cleaning suggestions. |
| `cleaning_service` | Apply approved actions in order and write the cleaned CSV. |

---

## 3. Frontend architecture

```text
frontend/
  app/            # Next.js App Router
  components/     # Shared UI pieces
  services/       # API client wrappers
  public/
```

### Frontend responsibilities

| Area | Role |
|------|------|
| Upload section | Choose CSV/XLSX and start the workflow |
| Loading state | Show staged progress messaging during upload and backend processing |
| Preview section | Show sample rows from profile response |
| Profiling section | Show row/column metrics, duplicate counts, null counts, and null percentages |
| Columns section | Let the user keep/drop columns before cleaning |
| Validation section | Show grouped findings with row-level detail and severity |
| Cleaning section | Let the user approve strategies and submit cleaning actions |
| Download section | Download the cleaned CSV |

---

## 4. Current API routes

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/upload` | Save uploaded file and return `file_id` |
| `GET` | `/profile` | Return profile data for `file_id` |
| `GET` | `/validations` | Return validation findings for `file_id` |
| `GET` | `/suggestions` | Return deterministic cleaning suggestions for `file_id` |
| `POST` | `/clean` | Apply approved actions and selected columns |
| `GET` | `/download` | Download cleaned CSV by file id |
| `GET` | `/health` | Simple backend health check |

---

## 5. Constraints

| Constraint | Approach |
|------------|----------|
| No LLM / AI | Suggestions come from deterministic rules only |
| No external APIs | FastAPI + local filesystem only |
| No background jobs | Work happens inside request handlers |
| No authentication | Single-user local workflow |
| No cloud storage | Files stay in `backend/storage/` |
| Large-file UX | Frontend avoids full null-row parsing in-browser and uses staged loading feedback |

---

*End of architecture overview.*
