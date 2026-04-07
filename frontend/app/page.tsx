"use client";

import { type ReactElement, useMemo, useState } from "react";
import Image from "next/image";
import HowItHelpsTimeline from "@/components/HowItHelpsTimeline";
import {
  getProfile,
  getSuggestions,
  getValidations,
  downloadCleanedFile,
  postClean,
  uploadFile,
  type ProfileResponse,
  type CleanResponse,
  type SuggestionItem,
  type ValidationFinding,
} from "@/services/api";
import {
  fillStrategyLabel,
  mapTypeMismatchToCleanAction,
  mapValidationFindingToCleanAction,
  mapSuggestionToCleanAction,
  normalizeRowTargetActions,
  orderCleanActionsForPipeline,
} from "@/lib/mapSuggestionsToClean";

type MirroredValidationSuggestion = {
  finding: ValidationFinding;
  index: number;
};

type MirroredValidationSuggestionGroup = {
  column: string;
  action: "drop_rows" | "clip_to_range";
  entries: MirroredValidationSuggestion[];
  issueLabels: string[];
  sampleValues: string[];
  affectedRows: number[];
  totalCount: number;
};

type TypeMismatchSuggestionGroup = {
  column: string;
  entries: Array<{ finding: ValidationFinding; index: number }>;
  sampleValues: string[];
  affectedRows: number[];
  totalCount: number;
};

type WorkspaceSection =
  | "upload"
  | "preview"
  | "profiling"
  | "columns"
  | "validation"
  | "cleaning";

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function loadingStateCopy(args: {
  isUploading: boolean;
  profileLoading: boolean;
  validationsLoading: boolean;
  suggestionsLoading: boolean;
}): { title: string; detail: string } {
  if (args.isUploading) {
    return {
      title: "Uploading file",
      detail: "Please wait while your dataset uploads and the workspace prepares your results.",
    };
  }
  if (args.profileLoading) {
    return {
      title: "Building dataset profile",
      detail: "Please wait while row counts, columns, and sample data are being analyzed.",
    };
  }
  if (args.validationsLoading) {
    return {
      title: "Running validation checks",
      detail: "Please wait while missing values, duplicates, dates, and type issues are reviewed.",
    };
  }
  return {
    title: "Preparing cleaning suggestions",
    detail: "Please wait while recommended fixes are generated for the uploaded dataset.",
  };
}

export default function HomePage() {
  const [fileId, setFileId] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [profile, setProfile] = useState<ProfileResponse | null>(null);
  const [uploadStatus, setUploadStatus] = useState<
    "idle" | "uploading" | "error"
  >("idle");
  const [isUploading, setIsUploading] = useState(false);
  const [profileLoading, setProfileLoading] = useState(false);
  const [validationsLoading, setValidationsLoading] = useState(false);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [cleanLoading, setCleanLoading] = useState(false);
  const [downloadLoading, setDownloadLoading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [suggestionsError, setSuggestionsError] = useState<string | null>(null);
  const [validationsError, setValidationsError] = useState<string | null>(null);
  const [cleanError, setCleanError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<SuggestionItem[]>([]);
  const [validations, setValidations] = useState<ValidationFinding[]>([]);
  const [expandedValidationColumns, setExpandedValidationColumns] = useState<Record<string, boolean>>({});
  const [validationApproved, setValidationApproved] = useState<boolean[]>([]);
  const [validationStrategies, setValidationStrategies] = useState<string[]>([]);
  const [validationRowSelections, setValidationRowSelections] = useState<string[]>([]);
  const [typeMismatchStrategies, setTypeMismatchStrategies] = useState<
    Record<string, "convert_numeric" | "drop_rows" | "replace">
  >({});
  const [typeMismatchApproved, setTypeMismatchApproved] = useState<Record<string, boolean>>({});
  const [typeMismatchRowSelections, setTypeMismatchRowSelections] = useState<Record<string, string>>({});
  const [typeMismatchReplacementValues, setTypeMismatchReplacementValues] = useState<Record<string, string>>({});
  const [suggestionStrategies, setSuggestionStrategies] = useState<string[]>([]);
  const [suggestionRowSelections, setSuggestionRowSelections] = useState<string[]>([]);
  const [suggestionFillValues, setSuggestionFillValues] = useState<string[]>([]);
  const [categoryMappingTargets, setCategoryMappingTargets] = useState<Record<number, string[]>>({});
  const [columnKeepSelections, setColumnKeepSelections] = useState<Record<string, boolean>>({});
  const [columnSearch, setColumnSearch] = useState("");
  const [activeSection, setActiveSection] = useState<WorkspaceSection>("upload");
  const [workspaceNotice, setWorkspaceNotice] = useState<string | null>(null);
  /** `true` = user approved this suggestion for apply */
  const [approved, setApproved] = useState<boolean[]>([]);
  const [cleanResult, setCleanResult] = useState<CleanResponse | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  function resetDataState() {
    setFileId(null);
    setFileName(null);
    setProfile(null);
    setProfileError(null);
    setProfileLoading(false);
    setValidationsLoading(false);
    setSuggestionsLoading(false);
    setSuggestions([]);
    setValidations([]);
    setExpandedValidationColumns({});
    setValidationApproved([]);
    setValidationStrategies([]);
    setValidationRowSelections([]);
    setTypeMismatchStrategies({});
    setTypeMismatchApproved({});
    setTypeMismatchRowSelections({});
    setTypeMismatchReplacementValues({});
    setSuggestionStrategies([]);
    setSuggestionRowSelections([]);
    setSuggestionFillValues([]);
    setCategoryMappingTargets({});
    setColumnKeepSelections({});
    setColumnSearch("");
    setActiveSection("upload");
    setWorkspaceNotice(null);
    setApproved([]);
    setValidationsError(null);
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
    setWorkspaceNotice(null);
    setProfileError(null);
    setSuggestionsError(null);
    setValidationsError(null);
    setCleanError(null);
    setCleanResult(null);
    setProfile(null);
    setSuggestions([]);
    setValidations([]);
    setExpandedValidationColumns({});
    setValidationApproved([]);
    setValidationStrategies([]);
    setValidationRowSelections([]);
    setTypeMismatchStrategies({});
    setTypeMismatchApproved({});
    setTypeMismatchReplacementValues({});
    setSuggestionStrategies([]);
    setSuggestionRowSelections([]);
    setSuggestionFillValues([]);
    setCategoryMappingTargets({});
    setApproved([]);
    setFileId(null);
    setUploadStatus("uploading");

    try {
      const data = await uploadFile(selectedFile);
      setFileId(data.file_id);
      setFileName(selectedFile.name);
      setUploadStatus("idle");

      let loadedProfile: ProfileResponse | null = null;
      setProfileLoading(true);
      try {
        const p = await getProfile(data.file_id);
        loadedProfile = p;
        setProfile(p);
        setActiveSection("preview");
        setColumnKeepSelections(
          Object.fromEntries(p.columns.map((column) => [column, true]))
        );
        setProfileError(null);
      } catch (e) {
        setProfile(null);
        setColumnKeepSelections({});
        setProfileError(
          e instanceof Error ? e.message : "Failed to load profile"
        );
        setProfileLoading(false);
        return;
      } finally {
        setProfileLoading(false);
      }

      let validationFindings: ValidationFinding[] = [];
      setValidationsLoading(true);
      try {
        const vr = await getValidations(data.file_id);
        validationFindings = vr.findings;
        setValidations(vr.findings);
        setExpandedValidationColumns({});
        setValidationApproved(vr.findings.map(() => false));
        setValidationStrategies(vr.findings.map((finding) => defaultValidationStrategy(finding)));
        setValidationRowSelections(
          vr.findings.map((finding) => finding.affected_row_indices.join(", "))
        );
        const mismatchColumns = Array.from(
          new Set(
            vr.findings
              .filter((finding) => finding.issue_type === "type_mismatch")
              .map((finding) => finding.column)
          )
        );
        setTypeMismatchStrategies(
          Object.fromEntries(mismatchColumns.map((column) => [column, "convert_numeric"]))
        );
        setTypeMismatchApproved(
          Object.fromEntries(mismatchColumns.map((column) => [column, true]))
        );
        setTypeMismatchRowSelections(
          Object.fromEntries(
            mismatchColumns.map((column) => {
              const rows = Array.from(
                new Set(
                  vr.findings
                    .filter(
                      (finding) =>
                        finding.issue_type === "type_mismatch" &&
                        finding.column === column
                    )
                    .flatMap((finding) => finding.affected_row_indices)
                )
              ).sort((a, b) => a - b);
              return [column, rows.join(", ")];
            })
          )
        );
        setTypeMismatchReplacementValues(
          Object.fromEntries(mismatchColumns.map((column) => [column, ""]))
        );
        setValidationsError(null);
      } catch (e) {
        setValidations([]);
        setExpandedValidationColumns({});
        setValidationApproved([]);
        setValidationStrategies([]);
        setValidationRowSelections([]);
        setTypeMismatchStrategies({});
        setTypeMismatchApproved({});
        setTypeMismatchRowSelections({});
        setTypeMismatchReplacementValues({});
        setValidationsError(
          e instanceof Error ? e.message : "Failed to load validations"
        );
      } finally {
        setValidationsLoading(false);
      }

      setSuggestionsLoading(true);
      try {
        const sg = await getSuggestions(data.file_id);
        setSuggestions(sg.suggestions);
        setSuggestionStrategies(
          sg.suggestions.map((suggestion) =>
            defaultStrategyForSuggestion(
              suggestion,
              validationForColumn(validationFindings, suggestion.column)
            )
          )
        );
        setSuggestionRowSelections(
          sg.suggestions.map((suggestion) =>
            defaultRowSelectionForSuggestion(
              suggestion,
              validationForColumn(validationFindings, suggestion.column)
            )
          )
        );
        setSuggestionFillValues(
          sg.suggestions.map((suggestion) =>
            defaultFillValueForSuggestion(
              suggestion,
              validationForColumn(validationFindings, suggestion.column),
              loadedProfile ?? profile ?? {
                file_id: "",
                file_path: "",
                total_row_count: 0,
                columns: [],
                dtypes: {},
                null_count: {},
                null_percentage: {},
                unique_count: {},
                duplicate_row_count: 0,
                sample_rows: [],
              }
            )
          )
        );
        setCategoryMappingTargets(
          Object.fromEntries(
            sg.suggestions.map((suggestion, index) => [
              index,
              (suggestion.mapping_groups ?? []).map((group) => group.to),
            ])
          )
        );
        setApproved(sg.suggestions.map(() => true));
        setSuggestionsError(null);
      } catch (e) {
        setSuggestions([]);
        setSuggestionStrategies([]);
        setSuggestionRowSelections([]);
        setSuggestionFillValues([]);
        setCategoryMappingTargets({});
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
      setValidations([]);
      setExpandedValidationColumns({});
      setValidationApproved([]);
      setValidationStrategies([]);
      setValidationRowSelections([]);
      setTypeMismatchStrategies({});
      setTypeMismatchApproved({});
      setTypeMismatchRowSelections({});
      setTypeMismatchReplacementValues({});
      setSuggestionStrategies([]);
      setSuggestionRowSelections([]);
      setSuggestionFillValues([]);
      setCategoryMappingTargets({});
      setColumnKeepSelections({});
      setColumnSearch("");
      setWorkspaceNotice(null);
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
      const selectedColumns = profile.columns.filter(
        (column) => columnKeepSelections[column] ?? true
      );
      const selectedColumnSet = new Set(selectedColumns);
      if (selectedColumns.length === 0) {
        throw new Error("Keep at least one column before applying changes.");
      }

      const approvedActions: Record<string, unknown>[] = [];
      for (let i = 0; i < validations.length; i++) {
        if (!validationApproved[i]) continue;
        const finding = validations[i];
        if (!selectedColumnSet.has(finding.column)) continue;
        const strategy = normalizeValidationStrategy(validationStrategies[i]);
        if (!strategy) continue;
        approvedActions.push(
          mapValidationFindingToCleanAction(
            finding,
            strategy,
            parseSelectedRowNumbers(validationRowSelections[i])
          )
        );
      }
      for (const group of Object.values(typeMismatchGroups)) {
        if (!typeMismatchApproved[group.column]) continue;
        if (!selectedColumnSet.has(group.column)) continue;
        const strategy = typeMismatchStrategies[group.column] ?? "convert_numeric";
        approvedActions.push(
          mapTypeMismatchToCleanAction(
            group.entries[0].finding,
            strategy,
            parseSelectedRowNumbers(typeMismatchRowSelections[group.column]) ??
              group.affectedRows,
            typeMismatchReplacementValues[group.column]
          )
        );
      }
      for (let i = 0; i < suggestions.length; i++) {
        if (!approved[i]) continue;
        const suggestion = suggestions[i];
        if (suggestion.column !== "*" && !selectedColumnSet.has(suggestion.column)) {
          continue;
        }
        const validation = validationForColumn(validations, suggestion.column);
        approvedActions.push(
          mapSuggestionToCleanAction(
            suggestion,
            profile,
            validation,
            normalizeStrategy(suggestionStrategies[i]),
            parseSelectedRowNumbers(suggestionRowSelections[i]),
            categoryMappingTargets[i],
            suggestionFillValues[i]
          )
        );
      }
      const dedupedActions = dedupeCleanActions(approvedActions);
      const normalizedActions = normalizeRowTargetActions(dedupedActions);
      const finalActions = orderCleanActionsForPipeline(normalizedActions);
      const result = await postClean(fileId, finalActions, selectedColumns);
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
  const keptColumnCount = profile
    ? profile.columns.filter((column) => columnKeepSelections[column] ?? true).length
    : 0;

  function validationForColumn(
    findings: ValidationFinding[],
    column: string
  ): ValidationFinding | undefined {
    return findings.find((finding) => finding.column === column);
  }

  function supportedStrategies(
    suggestion: SuggestionItem,
    validation?: ValidationFinding
  ): Array<"fill_missing" | "drop_rows" | "drop_column"> {
    if (suggestion.action !== "fill_missing" || !validation) {
      return [];
    }
    return validation.recommendations
      .map((recommendation) => recommendation.action)
      .filter(
        (action): action is "fill_missing" | "drop_rows" | "drop_column" =>
          action === "fill_missing" ||
          action === "drop_rows" ||
          action === "drop_column"
      );
  }

  function normalizeStrategy(
    strategy: string | undefined
  ): "fill_missing" | "drop_rows" | "drop_column" | undefined {
    if (
      strategy === "fill_missing" ||
      strategy === "drop_rows" ||
      strategy === "drop_column"
    ) {
      return strategy;
    }
    return undefined;
  }

  function defaultStrategyForSuggestion(
    suggestion: SuggestionItem,
    validation?: ValidationFinding
  ): string {
    const options = supportedStrategies(suggestion, validation);
    if (options.length > 0) {
      return options[0];
    }
    return suggestion.action;
  }

  function strategyLabel(
    strategy: "fill_missing" | "drop_rows" | "drop_column",
    validation?: ValidationFinding
  ): string {
    if (strategy === "fill_missing") {
      const fillRecommendation = validation?.recommendations.find(
        (recommendation) => recommendation.action === "fill_missing"
      );
      if (fillRecommendation?.fill_value !== undefined) {
        const strategyName = fillRecommendation.fill_strategy
          ? `${fillRecommendation.fill_strategy}: `
          : "";
        return `fill_missing (${strategyName}${String(fillRecommendation.fill_value)})`;
      }
    }
    return strategy;
  }

  function displayActionName(action: string): string {
    if (action === "convert_numeric") {
      return "convert_to_numeric";
    }
    return action;
  }

  function defaultRowSelectionForSuggestion(
    suggestion: SuggestionItem,
    validation?: ValidationFinding
  ): string {
    if (suggestion.action !== "fill_missing" || !validation) {
      return "";
    }
    return validation.affected_row_indices.join(", ");
  }

  function defaultFillValueForSuggestion(
    suggestion: SuggestionItem,
    validation: ValidationFinding | undefined,
    currentProfile: ProfileResponse
  ): string {
    if (suggestion.action !== "fill_missing") {
      return "";
    }
    const fillRecommendation = validation?.recommendations.find(
      (recommendation) => recommendation.action === "fill_missing"
    );
    if (fillRecommendation?.fill_value !== undefined) {
      return String(fillRecommendation.fill_value);
    }
    const dtype = currentProfile.dtypes[suggestion.column] ?? "";
    if (dtype === "bool" || dtype === "boolean") {
      return "false";
    }
    if (dtype.includes("int") || dtype.includes("float")) {
      return "0";
    }
    return "Unknown";
  }

  function parseSelectedRowNumbers(
    value: string | undefined
  ): number[] | undefined {
    if (!value) {
      return undefined;
    }
    const parsed = value
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => Number(part))
      .filter((num) => Number.isInteger(num) && num >= 2);
    return parsed.length > 0 ? parsed : undefined;
  }

  function dedupeCleanActions(
    actions: Record<string, unknown>[]
  ): Record<string, unknown>[] {
    const seen = new Set<string>();
    const deduped: Record<string, unknown>[] = [];
    for (const action of actions) {
      const key = JSON.stringify(action);
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(action);
    }
    return deduped;
  }

  function displayDropRowsSummary(rowsValue: string): string {
    return rowsValue.trim() ? rowsValue : "No rows selected";
  }

  function mergedValidationRows(
    entries: Array<{ finding: ValidationFinding; index: number }>
  ): number[] {
    return Array.from(
      new Set(
        entries.flatMap(({ finding, index }) => {
          return (
            parseSelectedRowNumbers(validationRowSelections[index]) ??
            finding.affected_row_indices
          );
        })
      )
    ).sort((a, b) => a - b);
  }

  function columnTags(column: string): string[] {
    if (!profile) return [];
    const tags: string[] = [];
    const lower = column.toLowerCase();
    const uniqueCount = profile.unique_count[column] ?? 0;
    const totalRows = profile.total_row_count || 0;
    const uniqueRatio = totalRows > 0 ? uniqueCount / totalRows : 0;
    const nullPct = profile.null_percentage[column] ?? 0;
    if (lower.includes("id")) tags.push("Key");
    if (uniqueRatio > 0.8) tags.push("High uniqueness");
    if (uniqueCount < 20) tags.push("Categorical");
    if (nullPct > 40) tags.push("Mostly empty");
    return tags;
  }

  function visibleColumns(): string[] {
    if (!profile) return [];
    const query = columnSearch.trim().toLowerCase();
    if (!query) return profile.columns;
    return profile.columns.filter((column) =>
      column.toLowerCase().includes(query)
    );
  }

  function setAllColumnKeeps(nextValue: boolean): void {
    if (!profile) return;
    setColumnKeepSelections(
      Object.fromEntries(profile.columns.map((column) => [column, nextValue]))
    );
  }

  function keepOnlyKeyColumns(): void {
    if (!profile) return;
    setColumnKeepSelections(
      Object.fromEntries(
        profile.columns.map((column) => [column, column.toLowerCase().includes("id")])
      )
    );
  }

  function removeMostlyEmptyColumns(): void {
    if (!profile) return;
    setColumnKeepSelections(
      Object.fromEntries(
        profile.columns.map((column) => [
          column,
          (profile.null_percentage[column] ?? 0) <= 40,
        ])
      )
    );
  }

  function supportedValidationStrategies(
    finding: ValidationFinding
  ): Array<"drop_rows" | "clip_to_range"> {
    if (finding.issue_type === "invalid_date") {
      return finding.recommendations
        .map((recommendation) => recommendation.action)
        .filter(
          (action): action is "drop_rows" | "clip_to_range" =>
            action === "drop_rows"
        );
    }
    if (finding.rule_type !== "range_check") {
      return [];
    }
    return finding.recommendations
      .map((recommendation) => recommendation.action)
      .filter(
        (action): action is "drop_rows" | "clip_to_range" =>
          action === "drop_rows" || action === "clip_to_range"
      );
  }

  function normalizeValidationStrategy(
    strategy: string | undefined
  ): "drop_rows" | "clip_to_range" | undefined {
    if (strategy === "drop_rows" || strategy === "clip_to_range") {
      return strategy;
    }
    return undefined;
  }

  function defaultValidationStrategy(finding: ValidationFinding): string {
    const options = supportedValidationStrategies(finding);
    if (options.includes("clip_to_range")) {
      return "clip_to_range";
    }
    if (options.includes("drop_rows")) {
      return "drop_rows";
    }
    return "";
  }

  function humanizeLabel(value: string | undefined | null): string {
    if (!value) {
      return "Issue";
    }
    return value
      .replace(/_/g, " ")
      .replace(/\b\w/g, (char) => char.toUpperCase());
  }

  function describeValidationFinding(finding: ValidationFinding): string {
    const label = humanizeLabel(finding.issue_type ?? finding.rule_type);
    if (finding.sample_values.length > 0) {
      return `${label} with ${finding.issue_count} item${finding.issue_count === 1 ? "" : "s"}`;
    }
    return `${label} found in ${finding.issue_count} row${finding.issue_count === 1 ? "" : "s"}`;
  }

  const groupedValidations = validations.reduce<
    Record<string, Array<{ finding: ValidationFinding; index: number }>>
  >((groups, finding, index) => {
    const key = finding.column;
    if (!groups[key]) {
      groups[key] = [];
    }
    groups[key].push({ finding, index });
    return groups;
  }, {});

  const mirroredValidationSuggestions: MirroredValidationSuggestion[] = validations
    .map((finding, index) => ({ finding, index }))
    .filter(({ finding }) => supportedValidationStrategies(finding).length > 0);

  const groupedMirroredValidationSuggestions = mirroredValidationSuggestions.reduce<
    Record<string, MirroredValidationSuggestionGroup>
  >((groups, entry) => {
    const action =
      normalizeValidationStrategy(validationStrategies[entry.index]) ??
      normalizeValidationStrategy(defaultValidationStrategy(entry.finding));

    if (!action) {
      return groups;
    }

    const key = `${entry.finding.column}_${action}`;
    const issueLabel = humanizeLabel(entry.finding.issue_type ?? entry.finding.rule_type);
    const sampleValues = entry.finding.sample_values.map((value) => String(value));

    if (!groups[key]) {
      groups[key] = {
        column: entry.finding.column,
        action,
        entries: [],
        issueLabels: [],
        sampleValues: [],
        affectedRows: [],
        totalCount: 0,
      };
    }

    groups[key].entries.push(entry);
    groups[key].issueLabels = Array.from(new Set([...groups[key].issueLabels, issueLabel]));
    groups[key].sampleValues = Array.from(new Set([...groups[key].sampleValues, ...sampleValues]));
    groups[key].affectedRows = Array.from(
      new Set([...groups[key].affectedRows, ...entry.finding.affected_row_indices])
    ).sort((a, b) => a - b);
    groups[key].totalCount += entry.finding.issue_count;

    return groups;
  }, {});

  const typeMismatchGroups = validations.reduce<Record<string, TypeMismatchSuggestionGroup>>(
    (groups, finding, index) => {
      if (finding.issue_type !== "type_mismatch") {
        return groups;
      }
      if (!groups[finding.column]) {
        groups[finding.column] = {
          column: finding.column,
          entries: [],
          sampleValues: [],
          affectedRows: [],
          totalCount: 0,
        };
      }
      groups[finding.column].entries.push({ finding, index });
      groups[finding.column].sampleValues = Array.from(
        new Set([
          ...groups[finding.column].sampleValues,
          ...finding.sample_values.map((value) => String(value)),
        ])
      );
      groups[finding.column].affectedRows = Array.from(
        new Set([...groups[finding.column].affectedRows, ...finding.affected_row_indices])
      ).sort((a, b) => a - b);
      groups[finding.column].totalCount += finding.issue_count;
      return groups;
    },
    {}
  );

  const typeMismatchGroupList = Object.keys(typeMismatchGroups).map(
    (column) => typeMismatchGroups[column]
  );
  const groupedMirroredValidationSuggestionList = Object.keys(
    groupedMirroredValidationSuggestions
  ).map((key) => groupedMirroredValidationSuggestions[key]);
  const hasApprovedTypeMismatchSuggestion = Object.keys(typeMismatchApproved).some(
    (column) => typeMismatchApproved[column]
  );
  const workspaceSections: Array<{ id: WorkspaceSection; label: string }> = [
    { id: "upload", label: "Upload" },
    { id: "preview", label: "Preview" },
    { id: "profiling", label: "Profiling" },
    { id: "columns", label: "Columns" },
    { id: "validation", label: "Validation" },
    { id: "cleaning", label: "Cleaning" },
  ];
  const availableSections = new Set<WorkspaceSection>(["upload"]);
  if (profile) {
    availableSections.add("preview");
    availableSections.add("profiling");
    availableSections.add("columns");
  }
  if (profile && !validationsLoading && !validationsError) {
    availableSections.add("validation");
  }
  if (
    profile &&
    !validationsLoading &&
    !validationsError &&
    !suggestionsLoading &&
    !suggestionsError
  ) {
    availableSections.add("cleaning");
  }
  const selectedColumns = profile
    ? profile.columns.filter((column) => columnKeepSelections[column] ?? true)
    : [];
  const hasSelectedColumns = selectedColumns.length > 0;
  const selectedColumnSet = new Set(selectedColumns);
  const filteredValidations = validations.filter((finding) =>
    selectedColumnSet.has(finding.column)
  );
  const filteredGroupedValidations = filteredValidations.reduce<
    Record<string, Array<{ finding: ValidationFinding; index: number }>>
  >((groups, finding, index) => {
    const originalIndex = validations.findIndex((candidate) => candidate === finding);
    const key = finding.column;
    if (!groups[key]) {
      groups[key] = [];
    }
    groups[key].push({ finding, index: originalIndex >= 0 ? originalIndex : index });
    return groups;
  }, {});
  const filteredMirroredValidationSuggestionList =
    groupedMirroredValidationSuggestionList.filter((group) =>
      selectedColumnSet.has(group.column)
    );
  const filteredTypeMismatchGroupList = typeMismatchGroupList.filter((group) =>
    selectedColumnSet.has(group.column)
  );
  const filteredSuggestions = suggestions.filter(
    (suggestion) =>
      suggestion.column !== "*" &&
      selectedColumnSet.has(suggestion.column) &&
      !(
        suggestion.action === "convert_to_numeric" &&
        filteredTypeMismatchGroupList.some((group) => group.column === suggestion.column)
      )
  );
  const gaugeSegments = 24;
  const currentLoadingState = loadingStateCopy({
    isUploading,
    profileLoading,
    validationsLoading,
    suggestionsLoading,
  });
  const { healthScore, issuesDetected } = useMemo(() => {
    const totalFindings = filteredValidations.length;
    const totalIssues = Math.min(totalFindings, 100);

    return {
      healthScore: profile ? 100 - totalIssues : 0,
      issuesDetected: profile ? totalFindings : 0,
    };
  }, [profile, filteredValidations]);
  const filledGaugeSegments = Math.round((healthScore / 100) * gaugeSegments);
  const profilingCards = profile
    ? [
        {
          label: "Total rows",
          value: profile.total_row_count,
          tone: "primary",
        },
        {
          label: "Total columns",
          value: profile.columns.length,
          tone: "primary",
        },
        {
          label: "Duplicates",
          value: profile.duplicate_row_count,
          tone: "primary",
        },
        {
          label: "Null %",
          value: `${Math.max(
            ...profile.columns.map((column) => profile.null_percentage[column] ?? 0),
            0
          ).toFixed(1)}%`,
          tone: "primary",
        },
      ]
    : [];
  const cleaningSections: Array<{ column: string; items: ReactElement[] }> = [];

  function pushCleaningItem(column: string, item: ReactElement) {
    const label = column === "*" ? "Entire dataset" : column;
    const existing = cleaningSections.find((section) => section.column === label);
    if (existing) {
      existing.items.push(item);
      return;
    }
    cleaningSections.push({ column: label, items: [item] });
  }

  filteredTypeMismatchGroupList.forEach((group) => {
    const selectedStrategy =
      typeMismatchStrategies[group.column] ?? "convert_numeric";
    const replacementValue =
      typeMismatchReplacementValues[group.column] ?? "";
    const summaryRowValue = group.affectedRows.join(", ");
    const rowValue =
      typeMismatchRowSelections[group.column] ?? summaryRowValue;

    pushCleaningItem(
      group.column,
      <article key={`type-mismatch-${group.column}`} className="action-card">
        <label className="action-card-check">
          <input
            type="checkbox"
            checked={typeMismatchApproved[group.column] ?? true}
            onChange={(e) => {
              setTypeMismatchApproved((current) => ({
                ...current,
                [group.column]: e.target.checked,
              }));
            }}
            aria-label={`Approve type mismatch fix for ${group.column}`}
          />
          <span>
            <strong>{displayActionName(selectedStrategy)}</strong>
          </span>
        </label>
        <p className="action-card-description">
          {group.totalCount} invalid value{group.totalCount === 1 ? "" : "s"} detected
        </p>
        {group.sampleValues.length > 0 && (
          <p className="action-card-meta">Samples: {group.sampleValues.join(", ")}</p>
        )}
        {selectedStrategy === "drop_rows" && (
          <>
            <p className="action-card-meta action-card-rows">
              Rows to drop: {displayDropRowsSummary(summaryRowValue)}
            </p>
          </>
        )}
        <div className="action-card-controls">
          <select
            value={selectedStrategy}
            onChange={(e) => {
              setTypeMismatchStrategies((current) => ({
                ...current,
                [group.column]: e.target.value as
                  | "convert_numeric"
                  | "drop_rows"
                  | "replace",
              }));
            }}
            aria-label={`Choose type mismatch action for ${group.column}`}
          >
            <option value="convert_numeric">convert_to_numeric</option>
            <option value="drop_rows">drop_rows</option>
            <option value="replace">replace</option>
          </select>
          {selectedStrategy === "drop_rows" && (
            <input
              type="text"
              value={rowValue}
              onChange={(e) => {
                setTypeMismatchRowSelections((current) => ({
                  ...current,
                  [group.column]: e.target.value,
                }));
              }}
              aria-label={`Rows to drop for ${group.column}`}
            />
          )}
          {selectedStrategy === "replace" && (
            <input
              type="text"
              value={replacementValue}
              onChange={(e) => {
                setTypeMismatchReplacementValues((current) => ({
                  ...current,
                  [group.column]: e.target.value,
                }));
              }}
              placeholder="Replacement value"
              aria-label={`Enter replacement value for ${group.column}`}
            />
          )}
        </div>
      </article>
    );
  });

  filteredMirroredValidationSuggestionList.forEach((group) => {
    const groupChecked = group.entries.some(
      ({ index }) => validationApproved[index] ?? false
    );
    const selectedStrategy =
      normalizeValidationStrategy(
        validationStrategies[group.entries[0].index]
      ) ?? group.action;
    const summaryRows = group.affectedRows;
    const summaryRowValue = summaryRows.join(", ");
    const rowValue =
      validationRowSelections[group.entries[0].index] ?? summaryRowValue;

    pushCleaningItem(
      group.column,
      <article
        key={`validation-suggestion-${group.column}-${group.action}`}
        className="action-card"
      >
        <label className="action-card-check">
          <input
            type="checkbox"
            checked={groupChecked}
            onChange={(e) => {
              const next = [...validationApproved];
              group.entries.forEach(({ index }) => {
                next[index] = e.target.checked;
              });
              setValidationApproved(next);
            }}
            aria-label={`Approve validation suggestion for ${group.column}`}
          />
          <span>
            <strong>{displayActionName(selectedStrategy)}</strong>
          </span>
        </label>
        <p className="action-card-description">
          {group.issueLabels.join(", ")} · {group.totalCount} affected item{group.totalCount === 1 ? "" : "s"}
        </p>
        {group.sampleValues.length > 0 && (
          <p className="action-card-meta">Samples: {group.sampleValues.join(", ")}</p>
        )}
        {selectedStrategy === "drop_rows" && (
          <>
            <p className="action-card-meta action-card-rows">
              Rows to drop: {displayDropRowsSummary(summaryRowValue)}
            </p>
          </>
        )}
        <div className="action-card-controls">
          <select
            value={selectedStrategy}
            onChange={(e) => {
              const next = [...validationStrategies];
              group.entries.forEach(({ index }) => {
                next[index] = e.target.value;
              });
              setValidationStrategies(next);
            }}
            aria-label={`Choose validation action for ${group.column}`}
          >
            {Array.from(
              new Set(
                group.entries.flatMap(({ finding }) =>
                  supportedValidationStrategies(finding)
                )
              )
            ).map((strategy) => (
              <option key={strategy} value={strategy}>
                {strategy}
              </option>
            ))}
          </select>
          {selectedStrategy === "drop_rows" && (
            <input
              type="text"
              value={rowValue}
              onChange={(e) => {
                const next = [...validationRowSelections];
                group.entries.forEach(({ index }) => {
                  next[index] = e.target.value;
                });
                setValidationRowSelections(next);
              }}
              placeholder="Rows to target"
              aria-label={`Choose validation suggestion rows for ${group.column}`}
            />
          )}
        </div>
      </article>
    );
  });

  filteredSuggestions.forEach((s) => {
    const i = suggestions.indexOf(s);
    const validation = validationForColumn(validations, s.column);
    const strategyOptions = supportedStrategies(s, validation);
    const selectedStrategy =
      normalizeStrategy(suggestionStrategies[i]) ??
      normalizeStrategy(defaultStrategyForSuggestion(s, validation));
    const selectedRows = suggestionRowSelections[i] ?? "";
    const fillValue = suggestionFillValues[i] ?? "";
    const fillMethodLabel =
      s.action === "fill_missing"
        ? fillStrategyLabel(validation, profile!, s.column)
        : "";
    const categoryTargets = categoryMappingTargets[i] ?? [];
    const summaryRows =
      s.action === "fill_missing" && validation
        ? validation.affected_row_indices
        : [];
    const summaryRowValue = summaryRows.join(", ");

    pushCleaningItem(
      s.column,
      <article key={i} className="action-card">
        <label className="action-card-check">
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
            <strong>{displayActionName(selectedStrategy ?? s.action)}</strong>
          </span>
        </label>
        <p className="action-card-description">{s.reason}</p>

        {s.action === "remove_duplicates" && s.column === "*" && (
          <p className="action-card-meta">
            Keeps the first exact row across the dataset and removes later identical rows.
          </p>
        )}

        {s.action === "remove_duplicates" && s.column !== "*" && (
          <p className="action-card-meta">
            Keeps the first row for each repeated {s.column} value and removes later duplicates.
          </p>
        )}

        {s.action === "standardize_values" &&
          s.groups &&
          s.groups.length > 0 && (
            <div className="mapping-group-list">
              {s.groups.map((group, groupIndex) => (
                <div key={`${s.column}-${groupIndex}`} className="mapping-group-row">
                  <span>{group.variants.join(", ")}</span>
                  <input
                    type="text"
                    value={categoryTargets[groupIndex] ?? group.canonical}
                    onChange={(e) => {
                      setCategoryMappingTargets((current) => ({
                        ...current,
                        [i]: (s.mapping_groups ?? []).map((mappingGroup, mappingIndex) =>
                          mappingIndex === groupIndex
                            ? e.target.value
                            : current[i]?.[mappingIndex] ?? mappingGroup.to
                        ),
                      }));
                    }}
                    aria-label={`Choose canonical value for ${s.column} group ${groupIndex + 1}`}
                  />
                </div>
              ))}
            </div>
          )}

        {selectedStrategy === "drop_rows" && (
          <>
            <p className="action-card-meta action-card-rows">
              Rows to drop: {displayDropRowsSummary(summaryRowValue)}
            </p>
          </>
        )}

        <div className="action-card-controls">
          {strategyOptions.length > 0 && (
            <select
              value={selectedStrategy ?? s.action}
              onChange={(e) => {
                const next = [...suggestionStrategies];
                next[i] = e.target.value;
                setSuggestionStrategies(next);
              }}
              aria-label={`Choose action for ${s.column}`}
            >
              {strategyOptions.map((strategy) => (
                <option key={strategy} value={strategy}>
                  {strategyLabel(strategy, validation)}
                </option>
              ))}
            </select>
          )}

          {selectedStrategy === "drop_rows" && (
            <input
              type="text"
              value={selectedRows}
              onChange={(e) => {
                const next = [...suggestionRowSelections];
                next[i] = e.target.value;
                setSuggestionRowSelections(next);
              }}
              placeholder="Rows to drop"
              aria-label={`Choose rows to drop for ${s.column}`}
            />
          )}

          {s.action === "fill_missing" &&
            selectedStrategy === "fill_missing" && (
              <input
                type="text"
                value={fillValue}
                onChange={(e) => {
                  const next = [...suggestionFillValues];
                  next[i] = e.target.value;
                  setSuggestionFillValues(next);
                }}
                placeholder="Fill value"
                aria-label={`Enter fill value for ${s.column}`}
              />
            )}
        </div>

        {s.action === "fill_missing" &&
          selectedStrategy === "fill_missing" && (
            <p className="action-card-meta">
              Suggested {fillMethodLabel.replace(/_/g, " ")} value. You can override it for this column.
            </p>
          )}
      </article>
    );
  });

  return (
    <div className="workspace-shell">
      <header className="topbar">
        <div className="topbar-brand">
          <span className="topbar-brand-mark">
            <Image
              src="/logo2.png"
              alt="DataPilot logo"
              width={36}
              height={36}
              className="topbar-brand-logo"
            />
          </span>
          <span className="topbar-brand-text">DataPilot</span>
        </div>
        <button
          type="button"
          className="ghost-button"
          onClick={() => {
            window.open("https://forms.gle/pHcxXYWveyRzUDxp7", "_blank", "noopener,noreferrer");
          }}
        >
          Feedback
        </button>
      </header>

      <div className="workspace-grid">
        <aside className="sidebar tile">
          <div className="sidebar-title">Workspace</div>
          <nav className="sidebar-nav" aria-label="Workspace sections">
            {workspaceSections.map((section) => {
              const disabled = !availableSections.has(section.id);
              return (
                <button
                  key={section.id}
                  type="button"
                  className={`sidebar-link ${activeSection === section.id ? "active" : ""}`}
                  onClick={() => {
                    if (!disabled) setActiveSection(section.id);
                  }}
                  disabled={disabled}
                >
                  {section.label}
                </button>
              );
            })}
          </nav>
        </aside>

        <section className="workspace-main">
          {(workspaceNotice || uploadError || profileError || suggestionsError || validationsError || cleanError) && (
            <div className="workspace-messages">
              {workspaceNotice && (
                <p className="message success" role="status">
                  {workspaceNotice}
                </p>
              )}
              {uploadError && uploadStatus === "error" && (
                <p className="message error" role="alert">
                  {uploadError}
                </p>
              )}
              {profileError && (
                <p className="message error" role="alert">
                  Profile could not be loaded: {profileError}
                </p>
              )}
              {suggestionsError && (
                <p className="message error" role="alert">
                  Suggestions could not be loaded: {suggestionsError}
                </p>
              )}
              {validationsError && (
                <p className="message error" role="alert">
                  Validation findings could not be loaded: {validationsError}
                </p>
              )}
              {cleanError && (
                <p className="message error" role="alert">
                  {cleanError}
                </p>
              )}
            </div>
          )}

          {(isUploading || profileLoading || validationsLoading || suggestionsLoading) && (
            <div className="tile loading-tile">
              <div className="loading-status" aria-live="polite">
                <div className="loading-status-copy">
                  <strong className="loading-title">{currentLoadingState.title}…</strong>
                  <p className="loading-inline">{currentLoadingState.detail}</p>
                </div>
                <div
                  className="loading-progress"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuetext={currentLoadingState.title}
                >
                  <span className="loading-progress-bar" />
                </div>
              </div>
            </div>
          )}

          {activeSection === "upload" && (
            <div className="workspace-stack">
              <section className="tile upload-hero" aria-labelledby="upload-heading">
                <div className="upload-hero-copy">
                  <span className="eyebrow">Data cleaning workspace</span>
                  <h1 id="upload-heading">Upload a dataset and start cleaning with guided fixes.</h1>
                  <p>
                    Review profile stats, inspect validation issues, and apply only the cleanup steps <strong><em>you want</em></strong>.
                  </p>
                </div>
                <div className="upload-dropzone">
                  {!profile ? (
                    <>
                      <label className="upload-dropzone-inner">
                        <span className="upload-dropzone-title">Drag &amp; drop a file here</span>
                        <span className="upload-dropzone-subtitle">Supported: CSV, XLSX</span>
                        <input
                          type="file"
                          accept=".csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
                          onChange={(e) => {
                            const f = e.target.files?.[0] ?? null;
                            setSelectedFile(f);
                            setUploadStatus("idle");
                            setUploadError(null);
                          }}
                        />
                      </label>
                      <div className="upload-actions">
                        <button
                          type="button"
                          className="primary-button"
                          onClick={handleUpload}
                          disabled={isUploading || !selectedFile}
                        >
                          Upload CSV / Excel
                        </button>
                        <span className="upload-selected-file">
                          {selectedFile ? selectedFile.name : "No file selected yet"}
                        </span>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="upload-dropzone-inner upload-success" role="status">
                        <span className="file-name">✓ {fileName ?? selectedFile?.name ?? "Dataset uploaded"}</span>
                        <span className="status">Uploaded successfully</span>
                        <div className="actions">
                          <label className="replace-file-button">
                            Replace file
                            <input
                              type="file"
                              accept=".csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
                              onChange={(e) => {
                                const f = e.target.files?.[0] ?? null;
                                if (!f) return;
                                setSelectedFile(f);
                                resetDataState();
                                setUploadStatus("idle");
                                setUploadError(null);
                              }}
                            />
                          </label>
                        </div>
                      </div>
                      <p className="section-note">
                        Dataset is ready for profiling, validation, and cleaning.
                      </p>
                    </>
                  )}
                </div>
              </section>

              <div className="onboarding-grid">
                <HowItHelpsTimeline />
              </div>
            </div>
          )}

          {!profile && activeSection !== "upload" && (
            <section className="tile empty-state-tile">
              <h2>{workspaceSections.find((section) => section.id === activeSection)?.label}</h2>
              <p>Upload a CSV or Excel file first to unlock this section of the workspace.</p>
              <button type="button" className="primary-button" onClick={() => setActiveSection("upload")}>
                Go to Upload
              </button>
            </section>
          )}

          {profile && activeSection === "preview" && (
            <section className="tile section-tile" aria-labelledby="preview-heading">
              <div className="section-heading">
                <div>
                  <span className="eyebrow">Dataset view</span>
                  <h2 id="preview-heading">Preview</h2>
                </div>
                <span className="pill-badge">
                  Sample rows: {profile.sample_rows.length}
                </span>
              </div>
              <div className="preview-table-wrap">
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
                        <td colSpan={Math.max(profile.columns.length, 1)} className="empty">
                          No rows in sample.
                        </td>
                      </tr>
                    ) : (
                      profile.sample_rows.map((row, i) => (
                        <tr key={i}>
                          {profile.columns.map((col) => {
                            const text = formatCell(row[col]);
                            return (
                              <td key={col} className={text === "" ? "empty" : undefined}>
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
          )}

          {profile && activeSection === "profiling" && (
            <section className="section-stack">
              <section className="tile section-tile" aria-labelledby="profiling-heading">
                <div className="section-heading">
                  <div>
                    <span className="eyebrow">Dataset profile</span>
                    <h2 id="profiling-heading">Profiling</h2>
                  </div>
                </div>
                <div className="metric-grid">
                  {profilingCards.map((card) => (
                    <article key={card.label} className={`metric-card ${card.tone}`}>
                      <span className="metric-label">{card.label}</span>
                      <strong className="metric-value">{card.value}</strong>
                    </article>
                  ))}
                </div>
              </section>

              <section className="tile section-tile">
                <div className="section-heading compact">
                  <h3>Null counts by column</h3>
                </div>
                <div className="key-value-grid">
                  {profile.columns.map((column) => {
                    const nullCount = profile.null_count[column] ?? 0;

                    return (
                      <div key={column} className="key-value-row">
                        <div className="null-column-name">
                          <span className="null-column-label">{column}</span>
                        </div>
                        <strong className="count">{nullCount}</strong>
                      </div>
                    );
                  })}
                </div>
              </section>
            </section>
          )}

          {profile && activeSection === "columns" && (
            <section className="tile section-tile" aria-labelledby="columns-heading">
              <div className="section-heading">
                <div>
                  <span className="eyebrow">Keep-first selection</span>
                  <h2 id="columns-heading">Columns</h2>
                </div>
                <span className="pill-badge">
                  Keeping {keptColumnCount} of {profile.columns.length}
                </span>
              </div>
              <div className="column-prune-controls">
                <input
                  type="text"
                  value={columnSearch}
                  onChange={(e) => setColumnSearch(e.target.value)}
                  placeholder="Search columns..."
                  aria-label="Search columns"
                  className="column-search-input"
                />
                <div className="column-prune-actions">
                  <button type="button" onClick={() => setAllColumnKeeps(true)}>
                    Select all
                  </button>
                  <button type="button" onClick={() => setAllColumnKeeps(false)}>
                    Deselect all
                  </button>
                  <button type="button" onClick={keepOnlyKeyColumns}>
                    Keep only key columns
                  </button>
                  <button type="button" onClick={removeMostlyEmptyColumns}>
                    Remove mostly empty
                  </button>
                </div>
              </div>
              <div className="column-table">
                <div className="column-table-head">
                  <span>Keep</span>
                  <span>Column</span>
                  <span>Tags</span>
                  <span>Type</span>
                  <span>Nulls</span>
                </div>
                {visibleColumns().map((column) => (
                  <label key={column} className="column-table-row">
                    <input
                      type="checkbox"
                      checked={columnKeepSelections[column] ?? true}
                      onChange={(e) => {
                        setColumnKeepSelections((current) => ({
                          ...current,
                          [column]: e.target.checked,
                        }));
                      }}
                      aria-label={`Keep column ${column}`}
                    />
                    <span className="column-name">{column}</span>
                    <span className="column-tag-row">
                      {columnTags(column).length > 0
                        ? columnTags(column).map((tag) => (
                            <span key={`${column}-${tag}`} className="column-tag">
                              {tag}
                            </span>
                          ))
                        : <span className="muted">—</span>}
                    </span>
                    <span className="column-prune-meta">{profile.dtypes[column] ?? "unknown"}</span>
                    <span className="column-prune-meta">{profile.null_count[column] ?? 0}</span>
                  </label>
                ))}
              </div>
            </section>
          )}

          {profile && activeSection === "validation" && (
            <section className="section-stack" aria-labelledby="validations-heading">
              <div className="tile section-tile">
                <div className="section-heading">
                  <div>
                    <span className="eyebrow">Quality checks</span>
                    <h2 id="validations-heading">Validation</h2>
                  </div>
                </div>
                {!hasSelectedColumns ? (
                  <p className="section-note">No columns selected</p>
                ) : filteredValidations.length === 0 ? (
                  <p className="section-note">No validation issues found.</p>
                ) : (
                  <div className="validation-column-list">
                    {Object.entries(filteredGroupedValidations).map(([column, entries]) => {
                      const isExpanded = expandedValidationColumns[column] ?? true;
                      const affectedRows = Array.from(
                        new Set(
                          entries.flatMap(({ finding }) => finding.affected_row_indices)
                        )
                      ).sort((a, b) => a - b);
                      const severitySet = Array.from(
                        new Set(
                          entries.map(({ finding }) =>
                            finding.severity === "error" ? "Error" : "Warning"
                          )
                        )
                      );

                      return (
                        <article key={column} className="validation-column-block">
                          <div className="validation-column-header">
                            <div className="validation-column-heading">
                              <span className="validation-column-name">{column}</span>
                              <span className="validation-column-meta">
                                Issues: {entries.length} | {affectedRows.length} rows affected
                              </span>
                            </div>
                            <div className="validation-column-controls">
                              <div className="validation-column-tags">
                                {severitySet.map((severity) => (
                                  <span
                                    key={`${column}-${severity}`}
                                    className={`severity-chip ${
                                      severity === "Error" ? "critical" : "warning"
                                    }`}
                                  >
                                    {severity}
                                  </span>
                                ))}
                              </div>
                              <button
                                type="button"
                                className="validation-toggle"
                                onClick={() =>
                                  setExpandedValidationColumns((current) => ({
                                    ...current,
                                    [column]: !(current[column] ?? true),
                                  }))
                                }
                              >
                                {isExpanded ? "Hide" : "Show"}
                              </button>
                            </div>
                          </div>
                          {isExpanded && (
                            <div className="validation-column-issues">
                              {entries.map(({ finding, index }) => {
                                const rows = finding.affected_row_indices;
                                const rowLabel = rows.length === 1 ? "Row" : "Rows";
                                const valueLabel =
                                  finding.sample_values.length === 1 ? "Value" : "Values";
                                const severityTone =
                                  finding.severity === "error" ? "critical" : "warning";
                                const recommendation =
                                  finding.issue_type === "category_mapping"
                                    ? "Standardizing categories"
                                    :
                                  finding.recommendations[0]?.reason ??
                                  "Fix in Cleaning Suggestions";

                                return (
                                  <div
                                    key={`${column}-${finding.issue_type ?? finding.rule_type}-${index}`}
                                    className="validation-issue-block"
                                  >
                                    <div className="validation-issue-header">
                                      <span className="validation-issue-name">
                                        {humanizeLabel(finding.issue_type ?? finding.rule_type)}
                                      </span>
                                      <span className={`severity-chip ${severityTone}`}>
                                        {finding.severity === "error" ? "Error" : "Warning"}
                                      </span>
                                    </div>

                                    <div className="validation-detail-group">
                                      <span className="validation-detail-label">{rowLabel}</span>
                                      <div className="validation-row-list">
                                        {rows.length > 0 ? (
                                          rows.map((row) => (
                                            <span key={`${column}-${index}-row-${row}`} className="row-chip">
                                              {row}
                                            </span>
                                          ))
                                        ) : (
                                          <span className="validation-empty-text">None</span>
                                        )}
                                      </div>
                                    </div>

                                    <div className="validation-detail-group">
                                      <span className="validation-detail-label">{valueLabel}</span>
                                      <div className="validation-value-list">
                                        {finding.sample_values.length > 0 ? (
                                          finding.sample_values.map((value, valueIndex) => (
                                            <span
                                              key={`${column}-${index}-value-${valueIndex}`}
                                              className="value-chip"
                                            >
                                              {formatCell(value) || "null"}
                                            </span>
                                          ))
                                        ) : (
                                          <span className="validation-empty-text">None</span>
                                        )}
                                      </div>
                                    </div>

                                    <div className="validation-action-box">
                                      <span className="validation-detail-label">
                                        Suggested action
                                      </span>
                                      <p className="validation-action-text">{recommendation}</p>
                                    </div>

                                    <button
                                      type="button"
                                      className="validation-cleaning-link"
                                      onClick={() => setActiveSection("cleaning")}
                                    >
                                      View in Cleaning →
                                    </button>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </article>
                      );
                    })}
                  </div>
                )}
              </div>
            </section>
          )}

          {profile && activeSection === "cleaning" && (
            <section className="section-stack" aria-labelledby="suggestions-heading">
              <section className="tile section-tile">
                <div className="section-heading">
                  <div>
                    <span className="eyebrow">Approved fixes</span>
                    <h2 id="suggestions-heading">Cleaning</h2>
                  </div>
                </div>
                {!hasSelectedColumns ? (
                  <p className="section-note">No columns selected</p>
                ) : filteredSuggestions.length === 0 &&
                filteredMirroredValidationSuggestionList.length === 0 &&
                filteredTypeMismatchGroupList.length === 0 ? (
                  <p className="section-note">No suggestions.</p>
                ) : (
                  <div className="cleaning-column-list">
                    {cleaningSections.map((section) => (
                      <section key={section.column} className="cleaning-column-group">
                        <h3 className="cleaning-column-heading">{section.column}</h3>
                        <div className="action-card-stack cleaning-action-list">
                          {section.items}
                        </div>
                      </section>
                    ))}
                  </div>
                )}
              </section>

              <section className="tile section-tile">
                <div className="cleaning-footer">
                  <div>
                    <h3>Ready to apply</h3>
                  </div>
                  <button
                    type="button"
                    className="primary-button"
                    onClick={handleApplyApproved}
                    disabled={
                      cleanLoading ||
                      !fileId ||
                      !profile ||
                      (
                        !approved.some(Boolean) &&
                        !validationApproved.some(Boolean) &&
                        !hasApprovedTypeMismatchSuggestion &&
                        keptColumnCount === profile.columns.length
                      )
                    }
                  >
                    {cleanLoading ? "Applying…" : "Apply Cleaning"}
                  </button>
                </div>
              </section>
            </section>
          )}

          {cleanResult && (
            <section className="tile section-tile" aria-labelledby="cleaned-heading">
              <div className="section-heading compact">
                <div>
                  <span className="eyebrow">Output</span>
                  <h2 id="cleaned-heading">Cleaned data</h2>
                </div>
                <span className="pill-badge success">Ready</span>
              </div>
              <p className="message success cleaned-output-status" role="status">
                Data cleaned successfully
              </p>
              <div className="download-actions">
                <button
                  type="button"
                  className="primary-button"
                  onClick={handleDownload}
                  disabled={downloadLoading}
                >
                  {downloadLoading ? "Preparing download…" : "Download cleaned CSV"}
                </button>
                <p className="hint">Saved at: <code>Downloads</code></p>
              </div>
            </section>
          )}
        </section>

        <aside className="insights-panel tile">
          <div className="insights-sticky">
            <div className="section-heading compact">
              <div>
                <span className="eyebrow">Workspace summary</span>
                <h2>Data Health</h2>
              </div>
            </div>
            <div className="gauge-wrapper">
              <div
                className="gauge-container"
                role="img"
                aria-label={`Data health score ${healthScore} out of 100`}
              >
                <div className="gauge-arc" aria-hidden="true">
                  {Array.from({ length: gaugeSegments }, (_, index) => {
                    const tone =
                      index < 8 ? "low" : index < 16 ? "mid" : "high";
                    const filled = index < filledGaugeSegments;
                    const angle = -90 + (180 / (gaugeSegments - 1)) * index;

                    return (
                      <span
                        key={index}
                        className={`health-segment ${filled ? `filled ${tone}` : ""}`}
                        style={{ "--segment-angle": `${angle}deg` } as React.CSSProperties}
                      />
                    );
                  })}
                </div>
                <div className="gauge-center">
                  <div className="score">{healthScore}</div>
                </div>
              </div>
              <div className="gauge-meta">
                <div className="issues">Issues detected: {issuesDetected}</div>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
