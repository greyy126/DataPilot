# DataPilot — Product Specification

## 1. Who is the user

**DataPilot** is for people who work with tabular data that arrives in inconsistent or messy form:

- **Data analysts** who need to standardize exports from tools, spreadsheets, or legacy systems before analysis.
- **Operations teams** who receive recurring CSV or Excel files and spend time fixing the same kinds of issues.
- **Students and learners** who want a focused tool for structured data cleaning without writing code for every routine fix.

The product assumes users are comfortable uploading files, reviewing summaries, and approving changes.

---

## 2. What problem it solves

Manual data cleaning is slow, repetitive, and error-prone. Common tasks such as spotting nulls, reviewing duplicates, checking column types, standardizing text, and fixing date formats often follow the same patterns across files.

**DataPilot** reduces that friction by:

- giving a clear **preview** and **profile** of the dataset
- surfacing **rule-based validation findings**
- offering **deterministic cleaning suggestions**
- requiring **user approval** before changes are applied
- applying approved steps with **Pandas** on the backend
- exporting a cleaned CSV at the end of the workflow

The goal is a straightforward local workflow: understand the data, choose fixes, run them, and save the result.

---

## 3. Current MVP features

| Area | Description |
|------|-------------|
| **File upload** | Accept **CSV** and **Excel** files uploaded through the app. |
| **Loading feedback** | Show staged loading states while upload, profiling, validation, and suggestion generation are running. |
| **Dataset preview** | Show a tabular preview of the loaded data from backend profile output. |
| **Data profiling** | Summarize **row count**, **column count**, **duplicate rows**, **null counts**, **null percentages**, **unique counts**, and **dtypes**. |
| **Validation findings** | Show rule-based findings for nulls, range issues, type mismatches, invalid dates, duplicate keys, and category mappings. |
| **Rule-based cleaning suggestions** | Propose actions using deterministic logic only. |
| **User approval** | The user explicitly selects which actions to apply. |
| **Apply cleaning** | The backend runs only approved transformations using **Pandas**. |
| **Export** | Download the cleaned dataset as **CSV**. |

### Technical alignment

- **Frontend:** Next.js with TypeScript
- **Backend:** FastAPI
- **Processing:** Pandas
- **Dataset storage:** Local files only
- **Database:** SQLite initialized locally
- **External calls:** None

---

## 4. What is not in scope

The following are out of scope for the current MVP:

- **LLMs, AI-based assistants, or ML models** for cleaning or suggestions
- **External API calls** or third-party enrichment services
- **Authentication, accounts, or multi-user collaboration**
- **Cloud storage** or drive integrations
- **Scheduling** or automated recurring pipelines
- **Background job queues**
- **PDFs, images, or unstructured data**
- **Client-side full-sheet parsing for large-file metadata**
  - the frontend should rely on API responses rather than building full null-row maps in the browser

---

## 5. Definition of done

The product is successful when all of the following are true on a local setup:

1. **End-to-end flow works:** upload → preview/profile → validation → suggestions → approve actions → clean → download.
2. **Findings and suggestions** are produced only by deterministic rule-based logic.
3. **Cleaned data** downloads correctly as CSV and matches the approved actions.
4. **The frontend stays responsive** during dataset processing by showing staged loading feedback and avoiding unnecessary in-browser dataset expansion.

---

## 6. Key design principles

1. **Keep it simple**: one clear workspace, minimal configuration.
2. **Deterministic behavior**: same input + same approved actions = same output.
3. **User approval before changes**: nothing mutates the dataset without explicit approval.
4. **No external dependencies for core product behavior**.
5. **Pragmatic large-file handling**: keep memory-heavy dataset work on the backend where possible.

---

## 7. Current user workflow

1. Upload a CSV or Excel file.
2. Wait through staged loading while the app prepares results.
3. Review the dataset preview.
4. Review profiling metrics.
5. Choose which columns to keep.
6. Review validation findings.
7. Review cleaning suggestions.
8. Apply approved cleaning actions.
9. Download the cleaned CSV.

---

*Document version: current MVP product specification for **DataPilot**.*
