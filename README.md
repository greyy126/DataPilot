# DataPilot

DataPilot is a deterministic data profiling, validation, and cleaning tool for CSV and Excel datasets. It provides a guided upload-to-download workflow for identifying common data quality issues, reviewing suggested fixes, and exporting a cleaned file.

## Tech Stack

### Frontend
- Next.js 15
- React 19
- TypeScript
- CSS via `frontend/app/globals.css`

### Backend
- FastAPI
- Pydantic
- pandas
- Uvicorn

### File Handling
- CSV upload and export
- Excel (`.xlsx`) upload support
- Local file storage under `backend/storage/uploads` and `backend/storage/cleaned`

## Current Flow

1. Upload a CSV or Excel file.
2. View a sample data preview.
3. Review the profiling summary.
4. Choose which columns to keep before cleaning.
5. Review validation findings.
6. Review cleaning suggestions.
7. Approve only the fixes you want to apply.
8. Run the cleaning pipeline.
9. Download the cleaned CSV.

## Implemented Features

### 1. Upload and Preview
- Upload `.csv` and `.xlsx` files
- Show staged loading states during upload, profiling, validation, and suggestion generation
- Preview sample rows from the uploaded dataset
- Track uploaded files by generated `file_id`

### 2. Profiling Summary
- Total row count
- Total column count
- Duplicate row count
- Null count by column
- Null percentage by column
- Unique count by column
- Inferred dtype by column

### 3. Column Selection
- Keep-first workflow
- Search columns by name
- Select all columns
- Deselect all columns
- Keep only key columns
- Remove mostly empty columns
- Column tags in the UI:
  - `Key`
  - `High uniqueness`
  - `Categorical`
  - `Mostly empty`

### 4. Validation Findings
The validator is intentionally rule-based and conservative.

Implemented validation categories:
- `null_check`
- `range_check`
- `type_check`

Implemented issue types:
- Missing values
- Negative numeric values
- Extreme numeric values
- Domain checks
- Numeric type mismatch
- Invalid dates
- Duplicate keys
- Category/value mapping inconsistencies

#### Null Validation
- Flags nulls only when null percentage is greater than 5%
- Severity:
  - `warning` above 10%
  - `error` above 40%
- Missing-value recommendations now use:
  - median for numeric or numeric-like columns
  - mode for categorical columns
  - placeholder/default text for identifier-like or high-uniqueness text fields such as email

#### Numeric Validation
- Negative values are flagged only when the column median is positive
- Extreme values use median-based bounds
- Tiny outlier noise is ignored
- Duplicate range findings are reduced where possible

#### Type Validation
- Detects invalid non-numeric values in mostly numeric columns
- Handles explicit invalid tokens like:
  - `""`
  - whitespace-only values
  - `NA`
  - `N/A`
  - `--`
  - `null`

#### Date Validation
- Detects invalid date strings in date-like columns
- Keeps invalid-date row fixes explicit instead of auto-dropping them

#### Duplicate Key Validation
- Detects repeated values in ID-like columns
- Identifies duplicate keys even when the repeated rows conflict

#### Category Mapping Validation
- Detects categorical inconsistencies such as:
  - `New York`, `new york`, `NY`, `NYC`
  - `Active`, `active`, `ACTIVE`
- Supports conservative abbreviation handling
- Avoids over-grouping unrelated abbreviations

### 5. Cleaning Suggestions
Cleaning suggestions are the action layer of the app. Validation findings describe issues; cleaning suggestions are where fixes are approved.

Implemented cleaning actions:
- `rename_column`
- `trim_whitespace`
- `normalize_case`
- `convert_to_numeric`
- `convert_numeric`
- `convert_to_date`
- `standardize_date`
- `fill_missing`
- `drop_rows`
- `drop_column`
- `clip_to_range`
- `replace`
- `remove_duplicates`
- `standardize_values`

### 6. Missing-Value Cleaning
- Suggested fill values are shown per column
- Users can still override the suggested fill value manually
- Supported alternatives for null issues:
  - fill missing values
  - drop affected rows
  - drop the column when appropriate

### 7. Date Cleaning
- `standardize_date` normalizes mixed valid date formats
- Invalid date rows are handled explicitly through row-level actions
- `convert_to_date` is not suggested when invalid dates would make it fail immediately

### 8. Duplicate Handling
- Full-row duplicate removal exists
- Key-level dedupe by ID-like columns is implemented
- Duplicate-key cleanup keeps one surviving row per repeated key
- Pipeline ordering was adjusted so dedupe runs after earlier row-level fixes

### 9. Category / Value Standardization
- Detects grouped categorical variants
- Suggests canonical values
- Lets users edit the canonical target before applying
- Applies only explicit approved mappings

### 10. Type-Mismatch Repair
- Convert numeric-like text to numeric
- Drop invalid rows
- Replace invalid values with a user-provided value

### 11. Download
- Export cleaned results as CSV

## Current UI Structure

The current page flow is:

1. Upload file
2. Data preview
3. Profiling summary
4. Column selection
5. Validation findings
6. Cleaning suggestions
7. Download cleaned output

## Backend API Endpoints

- `POST /upload`
- `GET /profile`
- `GET /validations`
- `GET /suggestions`
- `POST /clean`
- `GET /download`
- `GET /health`

## Project Structure

```text
Data-Collector/
├── backend/
│   ├── app/
│   │   ├── api/routes/
│   │   ├── models/schemas/
│   │   ├── services/
│   │   └── utils/
│   └── storage/
├── frontend/
│   ├── app/
│   ├── lib/
│   └── services/
└── docs/
```

## Run Locally

### Backend

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Frontend:
- `http://localhost:3000`

Backend:
- `http://127.0.0.1:8000`

## Notes

- The system is deterministic and rule-based.
- It does not use ML or fuzzy matching libraries.
- The frontend no longer parses full null-row maps in the browser; dataset profiling and validation details come from the API responses.
- The current focus is practical data cleaning for structured business datasets.
