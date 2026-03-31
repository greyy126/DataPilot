# Data Collector — Product Specification

## 1. Who is the user

**Data Collector** is for people who work with tabular data that arrives in inconsistent or messy form:

- **Data analysts** who need to standardize exports from tools, spreadsheets, or legacy systems before analysis.
- **Operations teams** who receive recurring CSV or Excel files and spend time fixing the same kinds of issues (extra spaces, wrong types, duplicates).
- **Students and learners** who are practicing data preparation and want a focused tool for structured cleaning without extra complexity.

The product assumes users are comfortable opening files, reviewing summaries, and approving changes—not that they want to write code for every routine fix.

---

## 2. What problem it solves

Manual data cleaning is slow, error-prone, and repetitive. Common tasks—spotting nulls, finding duplicates, checking column types, trimming text, standardizing values—often follow the same patterns file after file.

**Data Collector** reduces that friction by:

- Giving a clear **preview** and **profile** of the dataset so problems are visible quickly.
- Offering **rule-based suggestions** for cleaning steps (derived from data checks, not from generated prose).
- Letting the user **approve** exactly what runs before anything changes the data.
- Applying approved steps with **Pandas** on the server and letting the user **export** a cleaned CSV.

The goal is a straightforward local workflow: understand the data, choose fixes, run them, save the result—without cloud services or external integrations.

---

## 3. MVP features

| Area | Description |
|------|-------------|
| **File upload** | Accept **CSV** and **Excel** files uploaded through the app. |
| **Dataset preview** | Show a tabular preview of the loaded data (e.g. first rows, column headers). |
| **Data profiling** | Summarize **null counts**, **duplicate rows**, **column types**, and **unique value** signals where useful for cleaning decisions. |
| **Rule-based cleaning suggestions** | Propose actions using **deterministic rules** only (e.g. from profiling thresholds and predefined patterns). |
| **User approval** | The user explicitly selects or confirms which suggested actions to apply. Nothing is applied without approval. |
| **Apply cleaning** | The **FastAPI** backend runs **only approved** transformations using **Pandas**. |
| **Export** | Download the cleaned dataset as **CSV**. |
| **Workflow storage** | Persist saved workflows (e.g. which rules/steps were used) in **SQLite** for reuse or reference. |

**Technical alignment (MVP):**

- **Frontend:** Next.js with TypeScript  
- **Backend:** FastAPI  
- **Processing:** Pandas  
- **Dataset storage:** Local files only (no cloud)  
- **Workflow storage:** SQLite  
- **External calls:** None—no third-party APIs  

---

## 4. What is NOT in scope

The following are explicitly **out of scope** for this MVP:

- **LLMs, AI-based assistants, or any AI/ML models** used for cleaning, suggestions, or explanations—only explicit, rule-based logic.
- **External API calls** (including third-party data, maps, or enrichment services).
- **Authentication, accounts, or multi-user** collaboration; single local use is assumed.
- **Cloud storage**, sync, or **Google Drive** (and similar) integration.
- **Scheduling**, cron-style runs, or **automation** of pipelines.
- **Background job queues** or long-running async workers as a product requirement (simple request/response processing is enough for MVP scale).
- **PDF**, images, or other **unstructured** data processing—**CSV and Excel only**.

---

## 5. Definition of Done

The MVP is successful when all of the following are true on a **local** setup:

1. **End-to-end flow:** Upload → profile → review suggestions → approve selected actions → clean → export cleaned CSV, without manual server patching.
2. **Suggestions** are produced only by **rule-based** logic tied to profiling and fixed rules.
3. **Cleaned data** downloads correctly as CSV and matches what the approved steps should produce.
4. **Workflows** (or equivalent saved step metadata) are **persisted in SQLite** and can be loaded or referenced as designed.

---

## 6. Key design principles

1. **Keep it simple** — Few screens, clear steps, minimal configuration for the MVP.
2. **Deterministic rule-based logic** — Same input and same approved rules produce the same output.
3. **No over-engineering** — Avoid abstractions and infrastructure that the MVP does not need.
4. **Minimize external dependencies** — Prefer the stack already chosen; no optional services that pull in network or accounts.
5. **User approval before changes** — The dataset is only modified after explicit user consent to the listed actions.

---

*Document version: MVP product specification for **Data Collector**.*
