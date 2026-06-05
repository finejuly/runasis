const DEFAULT_RIEGEL_EXPONENT = 1.06;
const RIEGEL_EXPONENT_STORAGE_KEY = "runasis.riegelExponent.value";
const RIEGEL_EXPONENT_MODE_STORAGE_KEY = "runasis.riegelExponent.mode.v2";
const RIEGEL_SOURCE_DISTANCE_STORAGE_KEY = "runasis.riegel.sourceDistance";
const RIEGEL_REFERENCE_COLOR = "#17201a";
const RIEGEL_EXPONENT_MODES = new Set(["default", "median", "custom"]);
const DEFAULT_RIEGEL_EXPONENT_MODE = "median";
const DEFAULT_STRAVA_SCOPE = "activity:read_all";
const PERSONAL_BEST_DEFAULT_LIMIT = 3;
const PERSONAL_BEST_EXPANDED_LIMIT = 20;
const PERSONAL_BEST_TREND_LIMIT = 20;
const PERSONAL_BEST_TREND_LIMIT_OPTIONS = new Set([5, 10, 20]);
const RECENT_ACTIVITY_LIMIT = 5;
const REPOSITORY_URL = "";
const DAY_MS = 24 * 60 * 60 * 1000;
const YEAR_DAYS = 365.25;
const DEFAULT_DASHBOARD_METRIC_KEY = "distance";
const TEN_MILE_KM = 16.09;
const HALF_MARATHON_KM = 21.097;
const DISTANCE_DISTRIBUTION_BINS = [
  { min: 0, max: 5, label: "0-5 km", shortLabel: "0-5" },
  { min: 5, max: 10, label: "5-10 km", shortLabel: "5-10" },
  { min: 10, max: TEN_MILE_KM, label: "10 km-10 mile", shortLabel: "10-10mi" },
  { min: TEN_MILE_KM, max: HALF_MARATHON_KM, label: "10 mile-half marathon", shortLabel: "10mi-half" },
  { min: HALF_MARATHON_KM, max: Infinity, label: "Half marathon+", shortLabel: "Half+" }
];
const DASHBOARD_METRICS = {
  distance: {
    key: "distance",
    chartTitle: "Cumulative Distance",
    axisLabel: "Cumulative distance",
    noDataLabel: "No cumulative distance data",
    valueLabel: "Distance",
    getValue: (activity) => Number(activity.distance || 0) / 1000,
    formatValue: (value) => `${formatNumber(value, 1)} km`,
    formatAxisValue: (value) => `${formatNumber(value, 0)}km`,
    formatDelta: formatSignedDistanceKm
  },
  activities: {
    key: "activities",
    chartTitle: "Cumulative Activities",
    axisLabel: "Cumulative activities",
    noDataLabel: "No cumulative activity data",
    valueLabel: "Activities",
    getValue: () => 1,
    formatValue: (value) => `${formatInteger(value)} activities`,
    formatAxisValue: (value) => `${formatNumber(value, value % 1 ? 1 : 0)} act.`,
    formatDelta: formatSignedInteger
  },
  time: {
    key: "time",
    chartTitle: "Cumulative Time",
    axisLabel: "Cumulative time",
    noDataLabel: "No cumulative time data",
    valueLabel: "Time",
    getValue: (activity) => Number(activity.moving_time || 0) / 3600,
    formatValue: (value) => `${formatNumber(value, 1)} h`,
    formatAxisValue: (value) => `${formatNumber(value, value < 10 && value % 1 ? 1 : 0)}h`,
    formatDelta: formatSignedHours
  },
  elevation: {
    key: "elevation",
    chartTitle: "Cumulative Elevation Gain",
    axisLabel: "Cumulative elevation gain",
    noDataLabel: "No cumulative elevation data",
    valueLabel: "Elevation gain",
    getValue: (activity) => Number(activity.total_elevation_gain || 0),
    formatValue: (value) => `${formatInteger(Math.round(value))} m`,
    formatAxisValue: (value) => `${formatInteger(Math.round(value))}m`,
    formatDelta: formatSignedMeters
  }
};

const appState = {
  status: null,
  activities: [],
  personalBests: null,
  expandedPersonalBestDistances: new Set(),
  expandedTimeBestDurations: new Set(),
  personalBestTrendDistanceName: null,
  personalBestTrendLimit: PERSONAL_BEST_TREND_LIMIT,
  timeBestTrendDurationName: null,
  timeBestTrendLimit: PERSONAL_BEST_TREND_LIMIT,
  timeBestScale: "log",
  currentView: "dashboard",
  personalBestScale: "linear",
  riegelFiveKScale: "linear",
  riegelFiveKSeries: "top1",
  riegelExponent: DEFAULT_RIEGEL_EXPONENT,
  riegelCustomExponent: DEFAULT_RIEGEL_EXPONENT,
  riegelExponentMode: DEFAULT_RIEGEL_EXPONENT_MODE,
  riegelSourceDistanceName: "5K",
  rangeDays: "all",
  selectedKpiMetric: DEFAULT_DASHBOARD_METRIC_KEY,
  activityListOpen: false,
  allActivitySearch: "",
  allActivityRunOnly: false,
  allActivityDetailStatus: "all",
  allActivitySort: { key: "date", direction: "desc" },
  csrfToken: "",
  loading: false,
  syncing: false,
  detailSyncing: false,
  refreshingActivityId: null,
  excludingRecordKey: null,
  includeExcludedRecords: false,
  configSaving: false
};

const RIEGEL_TARGETS = [
  { name: "400m", distanceKm: 0.4 },
  { name: "1/2 mile", distanceKm: 0.805 },
  { name: "1K", distanceKm: 1 },
  { name: "1 mile", distanceKm: 1.609 },
  { name: "2 mile", distanceKm: 3.219 },
  { name: "5K", distanceKm: 5 },
  { name: "10K", distanceKm: 10 },
  { name: "15K", distanceKm: 15 },
  { name: "10 mile", distanceKm: 16.09 },
  { name: "20K", distanceKm: 20 },
  { name: "Half-Marathon", distanceKm: 21.097 },
  { name: "30K", distanceKm: 30 },
  { name: "Marathon", distanceKm: 42.195 },
  { name: "50K", distanceKm: 50 }
];
const EXPECTED_SUMMARY_TARGET_NAMES = ["Half-Marathon", "Marathon"];
const RIEGEL_EXPECTED_PACE_CHART_MAX_PROJECTED_DISTANCE_KM =
  RIEGEL_TARGETS.find((target) => target.name === "Marathon")?.distanceKm || 42.195;
const MIN_RIEGEL_EXPONENT_DISTANCE_KM = 0.4;

const els = {};

document.addEventListener("DOMContentLoaded", () => {
  cacheElements();
  configureRepositoryLink();
  loadPreferences();
  bindEvents();
  showAuthResult();
  loadData();
});

function cacheElements() {
  for (const id of [
    "connectionStatus",
    "connectButton",
    "syncButton",
    "clearButton",
    "repositoryLink",
    "clearConfirmDialog",
    "clearConfirmCancelButton",
    "clearConfirmDeleteButton",
    "riegelInfoButton",
    "riegelInfoDialog",
    "riegelInfoCloseButton",
    "riegelEquivalentInfoButton",
    "riegelEquivalentInfoDialog",
    "riegelEquivalentInfoCloseButton",
    "riegelProjectionInfoButton",
    "riegelProjectionInfoDialog",
    "riegelProjectionInfoCloseButton",
    "setupAlert",
    "setupForm",
    "stravaClientIdInput",
    "stravaClientSecretInput",
    "stravaConfigSaveButton",
    "athleteAvatar",
    "athleteMeta",
    "athleteName",
    "lastSync",
    "activityCount",
    "detailSync",
    "dashboardView",
    "activityListView",
    "pbView",
    "timeView",
    "analysisView",
    "analysisRankControl",
    "openActivityListButton",
    "backActivityListButton",
    "allActivityCountCaption",
    "allActivitySearchInput",
    "allActivityRunOnlyInput",
    "allActivityDetailStatusSelect",
    "allActivityTable",
    "rangeSelect",
    "kpiRangeCaption",
    "kpiDistance",
    "kpiDistanceSub",
    "kpiActivities",
    "kpiActivitiesSub",
    "kpiTime",
    "kpiTimeSub",
    "kpiElevation",
    "kpiElevationSub",
    "cumulativeMetricTitle",
    "cumulativeDistanceChart",
    "cumulativeDistanceCaption",
    "primaryDistanceTitle",
    "monthlyChart",
    "monthlyCaption",
    "distanceDistributionChart",
    "distanceDistributionCaption",
    "longRunList",
    "longRunCaption",
    "activityTable",
    "recentCaption",
    "personalBestChart",
    "personalBestChartCaption",
    "personalBestRecencyChart",
    "personalBestRecencyChartCaption",
    "personalBestTrendChart",
    "personalBestTrendCaption",
    "personalBestTrendDistanceSelect",
    "personalBestDurationGrid",
    "personalBestDurationCaption",
    "timeBestDistanceChart",
    "timeBestDistanceChartCaption",
    "timeBestRecencyChart",
    "timeBestRecencyChartCaption",
    "timeBestTrendChart",
    "timeBestTrendCaption",
    "timeBestTrendDurationSelect",
    "personalBestGrid",
    "personalBestCaption",
    "riegelExponentInput",
    "riegelSummaryGrid",
    "riegelEquivalentChartTitle",
    "riegelExpectedPaceChart",
    "riegelExpectedPaceChartCaption",
    "riegelFiveKChart",
    "riegelFiveKChartCaption",
    "riegelProjectionTitle",
    "riegelProjectionTable",
    "chartTooltip",
    "toast"
  ]) {
    els[id] = document.getElementById(id);
  }
  els.viewTabs = Array.from(document.querySelectorAll(".view-tab"));
  els.kpiCards = Array.from(document.querySelectorAll(".dashboard-kpi-card"));
  els.allActivitySortButtons = Array.from(document.querySelectorAll("[data-activity-sort]"));
  els.personalBestScaleButtons = Array.from(document.querySelectorAll(".pb-scale-option"));
  els.timeBestScaleButtons = Array.from(document.querySelectorAll(".time-scale-option"));
  els.personalBestTrendLimitButtons = Array.from(document.querySelectorAll(".pb-trend-limit-option"));
  els.timeBestTrendLimitButtons = Array.from(document.querySelectorAll(".time-trend-limit-option"));
  els.riegelFiveKScaleButtons = Array.from(document.querySelectorAll(".riegel-scale-option"));
  els.riegelFiveKSeriesButtons = Array.from(document.querySelectorAll(".riegel-series-option"));
  els.riegelExponentModeButtons = Array.from(document.querySelectorAll(".riegel-exponent-mode-option"));
  els.excludedRecordsToggleButtons = Array.from(document.querySelectorAll("[data-include-excluded-toggle]"));
}

function configureRepositoryLink(repositoryUrl = REPOSITORY_URL) {
  if (!els.repositoryLink) return;

  const normalizedUrl = typeof repositoryUrl === "string" ? repositoryUrl.trim() : "";
  if (!normalizedUrl) {
    els.repositoryLink.href = "";
    els.repositoryLink.classList.add("hidden");
    els.repositoryLink.setAttribute("aria-disabled", "true");
    return;
  }

  els.repositoryLink.href = normalizedUrl;
  els.repositoryLink.target = "_blank";
  els.repositoryLink.rel = "noreferrer";
  els.repositoryLink.classList.remove("hidden");
  els.repositoryLink.removeAttribute("aria-disabled");
}

function loadPreferences() {
  const savedExponent = readSavedRiegelExponent();
  appState.riegelCustomExponent = isValidRiegelExponent(savedExponent) ? savedExponent : DEFAULT_RIEGEL_EXPONENT;
  appState.riegelExponentMode = readSavedRiegelExponentMode()
    || (isValidRiegelExponent(savedExponent) && savedExponent !== DEFAULT_RIEGEL_EXPONENT ? "custom" : DEFAULT_RIEGEL_EXPONENT_MODE);
  appState.riegelExponent = appState.riegelExponentMode === "custom" ? appState.riegelCustomExponent : DEFAULT_RIEGEL_EXPONENT;
  appState.riegelSourceDistanceName = readSavedRiegelSourceDistanceName() || "5K";
  updateRiegelExponentControls();
}

function bindEvents() {
  els.setupForm.addEventListener("submit", saveStravaConfig);

  if (els.riegelInfoButton && els.riegelInfoDialog && els.riegelInfoCloseButton) {
    els.riegelInfoButton.addEventListener("click", openRiegelInfoDialog);
  }
  if (els.riegelEquivalentInfoButton && els.riegelEquivalentInfoDialog && els.riegelEquivalentInfoCloseButton) {
    els.riegelEquivalentInfoButton.addEventListener("click", openRiegelEquivalentInfoDialog);
  }
  if (els.riegelProjectionInfoButton && els.riegelProjectionInfoDialog && els.riegelProjectionInfoCloseButton) {
    els.riegelProjectionInfoButton.addEventListener("click", openRiegelProjectionInfoDialog);
  }

  els.connectButton.addEventListener("click", () => {
    const scope = encodeURIComponent(DEFAULT_STRAVA_SCOPE);
    window.location.href = `/auth/strava/start?scope=${scope}`;
  });

  els.syncButton.addEventListener("click", async () => {
    await syncActivities();
  });

  els.openActivityListButton.addEventListener("click", () => {
    appState.currentView = "dashboard";
    appState.activityListOpen = true;
    setActiveViewTab("dashboard");
    render();
  });

  els.backActivityListButton.addEventListener("click", () => {
    appState.activityListOpen = false;
    render();
  });

  els.allActivitySearchInput.addEventListener("input", () => {
    appState.allActivitySearch = els.allActivitySearchInput.value;
    renderAllActivities();
  });

  els.allActivityRunOnlyInput.addEventListener("change", () => {
    appState.allActivityRunOnly = els.allActivityRunOnlyInput.checked;
    renderAllActivities();
  });

  els.allActivityDetailStatusSelect.addEventListener("change", () => {
    appState.allActivityDetailStatus = els.allActivityDetailStatusSelect.value || "all";
    renderAllActivities();
  });

  for (const button of els.allActivitySortButtons) {
    button.addEventListener("click", () => {
      toggleAllActivitySort(button.dataset.activitySort);
      renderAllActivities();
    });
  }

  els.allActivityTable.addEventListener("click", handleAllActivityAction);

  els.clearButton.addEventListener("click", async () => {
    const confirmed = await confirmClearData();
    if (!confirmed) return;
    await fetchJson("/api/data", { method: "DELETE" });
    appState.activities = [];
    await loadData();
    toast("Saved data cleared.");
  });

  els.rangeSelect.addEventListener("change", () => {
    appState.rangeDays = els.rangeSelect.value;
    render();
  });

  for (const card of els.kpiCards) {
    card.addEventListener("click", () => {
      selectDashboardMetric(card.dataset.kpiMetric);
    });
    card.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      selectDashboardMetric(card.dataset.kpiMetric);
    });
  }


  for (const tab of els.viewTabs) {
    tab.addEventListener("click", () => {
      appState.currentView = tab.dataset.view;
      appState.activityListOpen = false;
      setActiveViewTab(appState.currentView);
      render();
    });
  }

  for (const button of els.personalBestScaleButtons) {
    button.addEventListener("click", () => {
      appState.personalBestScale = button.dataset.scale === "log" ? "log" : "linear";
      renderPersonalBestChart();
      renderPersonalBestRecencyChart();
    });
  }

  for (const button of els.timeBestScaleButtons || []) {
    button.addEventListener("click", () => {
      appState.timeBestScale = button.dataset.scale === "linear" ? "linear" : "log";
      renderTimeBestDistanceChart();
      renderTimeBestRecencyChart();
    });
  }

  els.personalBestTrendDistanceSelect.addEventListener("change", () => {
    appState.personalBestTrendDistanceName = els.personalBestTrendDistanceSelect.value || null;
    renderPersonalBestTrendChart();
  });

  for (const button of els.personalBestTrendLimitButtons) {
    button.addEventListener("click", () => {
      appState.personalBestTrendLimit = normalizePersonalBestTrendLimit(button.dataset.limit);
      renderPersonalBestTrendChart();
    });
  }

  els.timeBestTrendDurationSelect.addEventListener("change", () => {
    appState.timeBestTrendDurationName = els.timeBestTrendDurationSelect.value || null;
    renderTimeBestTrendChart();
  });

  for (const button of els.timeBestTrendLimitButtons || []) {
    button.addEventListener("click", () => {
      appState.timeBestTrendLimit = normalizePersonalBestTrendLimit(button.dataset.limit);
      renderTimeBestTrendChart();
    });
  }

  for (const button of els.riegelFiveKScaleButtons) {
    button.addEventListener("click", () => {
      appState.riegelFiveKScale = button.dataset.scale === "log" ? "log" : "linear";
      renderRiegelAnalysis();
    });
  }

  for (const button of els.riegelFiveKSeriesButtons) {
    button.addEventListener("click", () => {
      appState.riegelFiveKSeries = button.dataset.series || "top1";
      renderRiegelAnalysis();
    });
  }

  for (const button of els.riegelExponentModeButtons) {
    button.addEventListener("click", () => {
      appState.riegelExponentMode = normalizeRiegelExponentMode(button.dataset.mode) || DEFAULT_RIEGEL_EXPONENT_MODE;
      saveRiegelExponentMode(appState.riegelExponentMode);
      renderRiegelAnalysis();
    });
  }

  els.riegelExponentInput.addEventListener("input", () => {
    const value = Number(els.riegelExponentInput.value);
    if (!isValidRiegelExponent(value)) {
      els.riegelExponentInput.classList.add("invalid");
      return;
    }
    els.riegelExponentInput.classList.remove("invalid");
    appState.riegelExponentMode = "custom";
    appState.riegelCustomExponent = value;
    appState.riegelExponent = value;
    saveRiegelExponent(value);
    saveRiegelExponentMode("custom");
    updateRiegelExponentControls(value);
    renderRiegelAnalysis();
  });

  els.riegelExponentInput.addEventListener("blur", () => {
    if (!isValidRiegelExponent(Number(els.riegelExponentInput.value))) {
      els.riegelExponentInput.value = formatRiegelExponent(appState.riegelCustomExponent);
      els.riegelExponentInput.classList.remove("invalid");
    }
  });

  els.personalBestGrid.addEventListener("click", handlePersonalBestToggle);
  if (els.personalBestDurationGrid) {
    els.personalBestDurationGrid.addEventListener("click", handlePersonalBestToggle);
  }
  for (const button of els.excludedRecordsToggleButtons || []) {
    button.addEventListener("click", toggleIncludeExcludedRecords);
  }

  document.addEventListener("pointerover", handleChartTooltip);
  document.addEventListener("pointermove", handleChartTooltip);
  document.addEventListener("pointerout", (event) => {
    if (event.target instanceof Element && event.target.closest("[data-tooltip]")) {
      hideChartTooltip();
    }
  });
  document.addEventListener("click", handleRiegelChartSourceClick);
  document.addEventListener("keydown", (event) => {
    if ((event.key === "Enter" || event.key === " ") && isRiegelChartSourceTarget(event.target)) {
      event.preventDefault();
      handleRiegelChartSourceClick(event);
    }
  });
}

function openRiegelInfoDialog() {
  openInfoDialog(els.riegelInfoDialog, els.riegelInfoCloseButton);
}

function openRiegelEquivalentInfoDialog() {
  openInfoDialog(els.riegelEquivalentInfoDialog, els.riegelEquivalentInfoCloseButton);
}

function openRiegelProjectionInfoDialog() {
  openInfoDialog(els.riegelProjectionInfoDialog, els.riegelProjectionInfoCloseButton);
}

function openInfoDialog(dialog, closeButton) {
  const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const close = () => {
    dialog.classList.add("hidden");
    closeButton.removeEventListener("click", close);
    dialog.removeEventListener("click", handleBackdropClick);
    document.removeEventListener("keydown", handleKeydown);
    previouslyFocused?.focus();
  };
  const handleBackdropClick = (event) => {
    if (event.target === dialog) close();
  };
  const handleKeydown = (event) => {
    if (event.key === "Escape") {
      close();
      return;
    }
    if (event.key !== "Tab") return;

    const focusable = getFocusableElements(dialog);
    if (!focusable.length) {
      event.preventDefault();
      return;
    }
    const currentIndex = focusable.indexOf(document.activeElement);
    const fallbackIndex = event.shiftKey ? focusable.length - 1 : 0;
    const nextIndex = currentIndex === -1
      ? fallbackIndex
      : (currentIndex + (event.shiftKey ? -1 : 1) + focusable.length) % focusable.length;
    event.preventDefault();
    focusable[nextIndex].focus();
  };

  dialog.classList.remove("hidden");
  closeButton.addEventListener("click", close);
  dialog.addEventListener("click", handleBackdropClick);
  document.addEventListener("keydown", handleKeydown);
  closeButton.focus();
}

function confirmClearData() {
  if (!els.clearConfirmDialog || !els.clearConfirmCancelButton || !els.clearConfirmDeleteButton) {
    return Promise.resolve(window.confirm("Clear locally saved Strava tokens and activity data?"));
  }

  return new Promise((resolve) => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const close = (confirmed) => {
      els.clearConfirmDialog.classList.add("hidden");
      els.clearConfirmCancelButton.removeEventListener("click", handleCancel);
      els.clearConfirmDeleteButton.removeEventListener("click", handleDelete);
      els.clearConfirmDialog.removeEventListener("click", handleBackdropClick);
      document.removeEventListener("keydown", handleKeydown);
      previouslyFocused?.focus();
      resolve(confirmed);
    };
    const handleCancel = () => close(false);
    const handleDelete = () => close(true);
    const handleBackdropClick = (event) => {
      if (event.target === els.clearConfirmDialog) close(false);
    };
    const handleKeydown = (event) => {
      if (event.key === "Escape") {
        close(false);
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = getFocusableElements(els.clearConfirmDialog);
      if (!focusable.length) {
        event.preventDefault();
        return;
      }
      const currentIndex = focusable.indexOf(document.activeElement);
      const fallbackIndex = event.shiftKey ? focusable.length - 1 : 0;
      const nextIndex = currentIndex === -1
        ? fallbackIndex
        : (currentIndex + (event.shiftKey ? -1 : 1) + focusable.length) % focusable.length;
      event.preventDefault();
      focusable[nextIndex].focus();
    };

    els.clearConfirmDialog.classList.remove("hidden");
    els.clearConfirmCancelButton.addEventListener("click", handleCancel);
    els.clearConfirmDeleteButton.addEventListener("click", handleDelete);
    els.clearConfirmDialog.addEventListener("click", handleBackdropClick);
    document.addEventListener("keydown", handleKeydown);
    els.clearConfirmCancelButton.focus();
  });
}

function getFocusableElements(container) {
  if (!container) return [];
  return Array.from(container.querySelectorAll("button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])"))
    .filter((element) => element instanceof HTMLElement && !element.disabled && element.getClientRects().length > 0);
}

function readSavedRiegelExponent() {
  try {
    return Number(window.localStorage.getItem(RIEGEL_EXPONENT_STORAGE_KEY));
  } catch {
    return null;
  }
}

function saveRiegelExponent(value) {
  try {
    window.localStorage.setItem(RIEGEL_EXPONENT_STORAGE_KEY, String(value));
  } catch {
    // Persistence is optional; the current session value still applies.
  }
}

function readSavedRiegelExponentMode() {
  try {
    return normalizeRiegelExponentMode(window.localStorage.getItem(RIEGEL_EXPONENT_MODE_STORAGE_KEY));
  } catch {
    return null;
  }
}

function saveRiegelExponentMode(mode) {
  try {
    window.localStorage.setItem(RIEGEL_EXPONENT_MODE_STORAGE_KEY, normalizeRiegelExponentMode(mode) || DEFAULT_RIEGEL_EXPONENT_MODE);
  } catch {
    // Persistence is optional; the current session value still applies.
  }
}

function readSavedRiegelSourceDistanceName() {
  try {
    return window.localStorage.getItem(RIEGEL_SOURCE_DISTANCE_STORAGE_KEY);
  } catch {
    return null;
  }
}

function saveRiegelSourceDistanceName(name) {
  try {
    window.localStorage.setItem(RIEGEL_SOURCE_DISTANCE_STORAGE_KEY, String(name || "5K"));
  } catch {
    // Persistence is optional; the current session value still applies.
  }
}

function normalizeRiegelExponentMode(mode) {
  return RIEGEL_EXPONENT_MODES.has(mode) ? mode : null;
}

function getRiegelExponent(medianExponent = null) {
  if (appState.riegelExponentMode === "median" && Number.isFinite(medianExponent)) return medianExponent;
  if (appState.riegelExponentMode === "custom" && isValidRiegelExponent(appState.riegelCustomExponent)) return appState.riegelCustomExponent;
  return DEFAULT_RIEGEL_EXPONENT;
}

function updateRiegelExponentControls(activeExponent = appState.riegelExponent) {
  if (els.riegelExponentInput) {
    els.riegelExponentInput.value = formatRiegelExponent(activeExponent);
    els.riegelExponentInput.disabled = appState.riegelExponentMode !== "custom";
  }
  for (const button of els.riegelExponentModeButtons || []) {
    button.classList.toggle("active", button.dataset.mode === appState.riegelExponentMode);
  }
}

function formatRiegelExponentMode(mode) {
  if (mode === "median") return "Median";
  if (mode === "custom") return "Custom";
  return "Default";
}

function isValidRiegelExponent(value) {
  return Number.isFinite(value) && value > 0;
}

async function loadData() {
  setLoading(true);
  try {
    const payload = await fetchJson("/api/activities");
    const personalBests = await fetchJson(personalBestsApiUrl());
    appState.status = payload.status;
    appState.csrfToken = payload.status?.csrfToken || appState.csrfToken;
    appState.activities = payload.activities || [];
    appState.personalBests = personalBests;
    render();
  } catch (error) {
    toast(error.message || "Could not load data.");
  } finally {
    setLoading(false);
  }
}

function personalBestsApiUrl() {
  return appState.includeExcludedRecords
    ? "/api/personal-bests?includeExcluded=true"
    : "/api/personal-bests";
}

async function loadPersonalBests() {
  appState.personalBests = await fetchJson(personalBestsApiUrl());
}

async function syncActivities() {
  if (!appState.status?.connected) {
    toast("Strava connection is required.");
    return;
  }

  setSyncing(true);
  try {
    const result = await fetchJson("/api/sync", { method: "POST", body: "{}" });
    const pendingDetails = Number(result.status?.activityDetails?.pendingRunCount || 0);
    const pendingRawDetails = Number(result.status?.activityDetails?.pendingRawRunCount || 0);
    const pendingRawStreams = Number(result.status?.activityDetails?.pendingRawStreamRunCount || 0);
    let detailResult = null;
    if (pendingDetails > 0 || pendingRawDetails > 0 || pendingRawStreams > 0) {
      setDetailSyncing(true);
      try {
        detailResult = await fetchJson("/api/activity-details/sync", { method: "POST", body: "{}" });
      } finally {
        setDetailSyncing(false);
      }
    }
    await loadData();
    const summary = result.summary;
    const detailMessage = detailResult ? ` ${formatActivityDetailSyncMessage(detailResult.summary)}` : "";
    toast(`Sync complete: ${summary.inserted} new, ${summary.updated} updated.${detailMessage}`.trim());
  } catch (error) {
    toast(error.message || "Sync failed.");
  } finally {
    setDetailSyncing(false);
    setSyncing(false);
  }
}

async function syncActivityDetails() {
  if (!appState.status?.connected) {
    toast("Strava connection is required.");
    return;
  }

  setDetailSyncing(true);
  try {
    const result = await fetchJson("/api/activity-details/sync", { method: "POST", body: "{}" });
    await loadData();
    const summary = result.summary;
    toast(formatActivityDetailSyncMessage(summary));
  } catch (error) {
    toast(error.message || "Could not fetch best efforts.");
  } finally {
    setDetailSyncing(false);
  }
}

function formatActivityDetailSyncMessage(summary = {}) {
  const rawBackfilled = Number(summary.rawBackfilled || 0);
  const rawStreamsFetched = Number(summary.rawStreamsFetched || 0);
  const streamFailed = Number(summary.streamFailed || 0);
  if (!summary.fetched && !summary.remaining) {
    const failed = Number(summary.failed || 0) + Number(summary.skippedFailed || 0);
    if (rawBackfilled && rawStreamsFetched) {
      return `Raw details: ${formatInteger(rawBackfilled)} saved. Streams: ${formatInteger(rawStreamsFetched)} saved.`;
    }
    if (rawBackfilled) return `Raw details: ${formatInteger(rawBackfilled)} saved.`;
    if (rawStreamsFetched) return `Streams: ${formatInteger(rawStreamsFetched)} saved.`;
    return failed
      ? `No new best efforts to fetch. ${formatInteger(failed + streamFailed)} failures saved`
      : "All best efforts have already been fetched.";
  }
  const stopped = summary.stoppedReason === "rate_limited" ? ", rate limit reached" : "";
  const extras = [];
  if (rawBackfilled) extras.push(`${formatInteger(rawBackfilled)} raw saved`);
  if (rawStreamsFetched) extras.push(`${formatInteger(rawStreamsFetched)} streams saved`);
  if (streamFailed) extras.push(`${formatInteger(streamFailed)} stream failed`);
  const extraMessage = extras.length ? `, ${extras.join(", ")}` : "";
  return `Best efforts: ${summary.fetched} new, ${summary.failed} failed, ${summary.remaining} remaining${extraMessage}${stopped}`;
}

async function refreshActivityDetail(activityId) {
  if (!appState.status?.connected) {
    toast("Strava connection is required.");
    return;
  }

  const id = String(activityId || "").trim();
  if (!id) return;

  setActivityRefreshing(id);
  try {
    await fetchJson("/api/activity-details/refresh", {
      method: "POST",
      body: JSON.stringify({ activityId: id })
    });
    await loadData();
    toast("Activity refreshed.");
  } catch (error) {
    toast(error.message || "Could not refresh activity.");
  } finally {
    setActivityRefreshing(null);
  }
}

async function updateRecordExclusion(recordKey, excluded) {
  const key = String(recordKey || "").trim();
  if (!key) return;

  setRecordExcluding(key);
  try {
    await fetchJson("/api/excluded-records", {
      method: "POST",
      body: JSON.stringify({ recordKey: key, excluded: Boolean(excluded) })
    });
    await loadPersonalBests();
    render();
    toast(excluded ? "Record excluded." : "Record included.");
  } catch (error) {
    toast(error.message || "Could not update record.");
  } finally {
    setRecordExcluding(null);
  }
}

async function toggleIncludeExcludedRecords() {
  const previous = appState.includeExcludedRecords;
  appState.includeExcludedRecords = !previous;
  updateExcludedRecordsToggleButtons();
  try {
    await loadPersonalBests();
    render();
  } catch (error) {
    appState.includeExcludedRecords = previous;
    updateExcludedRecordsToggleButtons();
    toast(error.message || "Could not load excluded records.");
  }
}

async function saveStravaConfig(event) {
  event.preventDefault();
  const clientId = els.stravaClientIdInput.value.trim();
  const clientSecret = els.stravaClientSecretInput.value.trim();
  if (!clientId || !clientSecret) {
    toast("Enter both Client ID and Client Secret.");
    return;
  }

  setConfigSaving(true);
  try {
    const result = await fetchJson("/api/config/strava", {
      method: "POST",
      body: JSON.stringify({ clientId, clientSecret })
    });
    appState.status = result.status;
    els.stravaClientSecretInput.value = "";
    render();
    toast("Saved Strava settings to .env.");
  } catch (error) {
    toast(error.message || "Could not save Strava settings.");
  } finally {
    setConfigSaving(false);
  }
}

async function fetchJson(url, options = {}) {
  const method = String(options.method || "GET").toUpperCase();
  const headers = {
    "content-type": "application/json",
    ...(options.headers || {})
  };
  if (method !== "GET" && method !== "HEAD" && appState.csrfToken) {
    headers["x-runasis-csrf"] = appState.csrfToken;
  }

  const response = await fetch(url, {
    ...options,
    headers
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `Request failed (${response.status})`);
  }
  return payload;
}

function render() {
  renderStatus();
  renderView();
  updateExcludedRecordsToggleButtons();
  if (appState.currentView === "pb") {
    renderPersonalBestChart();
    renderPersonalBestRecencyChart();
    renderPersonalBestTrendChart();
    renderPersonalBests();
    return;
  }
  if (appState.currentView === "time") {
    renderTimeBestsView();
    return;
  }
  if (appState.currentView === "analysis") {
    renderRiegelAnalysis();
    return;
  }
  if (appState.activityListOpen) {
    renderAllActivities();
    return;
  }

  const activities = getFilteredActivities();
  const metrics = calculateMetrics(activities);
  const previousMetrics = calculatePreviousPeriodMetrics();
  renderKpiRangeCaption(activities);
  renderKpis(metrics, previousMetrics);
  renderKpiSelection();
  renderCharts(activities);
  renderLongRuns(activities);
  renderTable(activities);
}

function renderStatus() {
  const status = appState.status || {};
  els.setupAlert.classList.toggle("hidden", status.configured !== false);
  els.connectionStatus.classList.remove("connected", "missing");

  if (!status.configured) {
    els.connectionStatus.textContent = "Setup Needed";
    els.connectionStatus.classList.add("missing");
  } else if (status.connected) {
    els.connectionStatus.textContent = "Connected";
    els.connectionStatus.classList.add("connected");
  } else {
    els.connectionStatus.textContent = "Not Connected";
  }

  if (status.athlete) {
    const name = [status.athlete.firstname, status.athlete.lastname].filter(Boolean).join(" ");
    els.athleteName.textContent = name || status.athlete.username || "Strava Athlete";
    els.athleteMeta.textContent = status.athlete.username ? `@${status.athlete.username}` : "Strava account";
    if (status.athlete.profile) {
      els.athleteAvatar.innerHTML = `<img src="${escapeHtml(status.athlete.profile)}" alt="">`;
    } else {
      els.athleteAvatar.textContent = (name || "R").slice(0, 1).toUpperCase();
    }
  } else {
    els.athleteName.textContent = "My running log";
    els.athleteMeta.textContent = "No Strava account connected";
    els.athleteAvatar.textContent = "R";
  }

  els.lastSync.textContent = status.lastSyncAt
    ? `Last sync ${formatDateTime(status.lastSyncAt)}`
    : "No sync yet";
  els.activityCount.textContent = `${formatInteger(status.activityCount || 0)} activities · ${formatInteger(status.runCount || 0)} runs`;
  const detailStatus = status.activityDetails || {};
  const failedDetails = Number(detailStatus.failedRunCount || 0);
  const streamStatus = detailStatus.rawStreamRunCount !== undefined
    ? ` · Streams ${formatInteger(detailStatus.rawStreamRunCount || 0)}/${formatInteger(detailStatus.runCount || 0)}`
    : "";
  els.detailSync.textContent = `Best efforts ${formatInteger(detailStatus.fetchedRunCount || 0)}/${formatInteger(detailStatus.runCount || 0)}${streamStatus}${failedDetails ? ` · ${formatInteger(failedDetails)} failed` : ""}`;
  updateActionButtons();
}

function getFilteredActivities() {
  const range = getDashboardDateRange(appState.activities);

  return appState.activities
    .filter((activity) => {
      if (!isRun(activity)) return false;
      if (!range) return true;
      const date = getActivityLocalDay(activity);
      return date && date >= range.start && date <= range.end;
    })
    .sort((a, b) => new Date(b.start_date || 0) - new Date(a.start_date || 0));
}

function getPreviousPeriodActivities() {
  const previousRange = getPreviousDashboardDateRange();
  if (!previousRange) return [];

  return appState.activities.filter((activity) => {
    if (!isRun(activity)) return false;
    const date = getActivityLocalDay(activity);
    return date && date >= previousRange.start && date <= previousRange.end;
  });
}

function calculatePreviousPeriodMetrics() {
  if (appState.rangeDays === "all") return null;
  return calculateMetrics(getPreviousPeriodActivities());
}

function calculateMetrics(activities) {
  const distance = sum(activities, (activity) => Number(activity.distance || 0));
  const movingTime = sum(activities, (activity) => Number(activity.moving_time || 0));
  const elevation = sum(activities, (activity) => Number(activity.total_elevation_gain || 0));
  return {
    count: activities.length,
    distanceKm: distance / 1000,
    movingHours: movingTime / 3600,
    elevation,
    paceSecondsPerKm: distance > 0 ? movingTime / (distance / 1000) : null
  };
}

function renderKpiRangeCaption(activities) {
  const range = getDashboardDateRange(activities);
  if (!range) {
    els.kpiRangeCaption.textContent = "No range";
    return;
  }

  const label = appState.rangeDays === "all" ? "All time" : selectedRangeLabel();
  els.kpiRangeCaption.textContent = `${label} · ${formatDate(range.start)} - ${formatDate(range.end)}`;
}

function renderKpis(metrics, previousMetrics = null) {
  els.kpiDistance.textContent = `${formatNumber(metrics.distanceKm, 1)} km`;
  els.kpiActivities.textContent = formatInteger(metrics.count);
  els.kpiTime.textContent = `${formatNumber(metrics.movingHours, 1)} h`;
  els.kpiElevation.textContent = `${formatInteger(Math.round(metrics.elevation))} m`;

  if (previousMetrics) {
    setKpiSubContent(els.kpiDistanceSub, formatKpiDelta(metrics.distanceKm - previousMetrics.distanceKm, formatSignedDistanceKm, "higher"));
    setKpiSubContent(els.kpiActivitiesSub, formatKpiDelta(metrics.count - previousMetrics.count, formatSignedInteger, "higher"));
    setKpiSubContent(els.kpiTimeSub, formatKpiDelta(metrics.movingHours - previousMetrics.movingHours, formatSignedHours, "higher"));
    setKpiSubContent(els.kpiElevationSub, formatKpiDelta(metrics.elevation - previousMetrics.elevation, formatSignedMeters, "higher"));
    return;
  }

  setKpiSubContent(els.kpiDistanceSub);
  setKpiSubContent(els.kpiActivitiesSub);
  setKpiSubContent(els.kpiTimeSub);
  setKpiSubContent(els.kpiElevationSub);
}

function setKpiSubContent(element, content = "") {
  element.innerHTML = content;
  element.classList.toggle("hidden", !content);
}

function selectDashboardMetric(metricKey) {
  if (!DASHBOARD_METRICS[metricKey]) return;
  appState.selectedKpiMetric = metricKey;
  renderKpiSelection();
  renderCumulativeMetricChart(appState.activities);
  renderWeeklyMetricChart(getFilteredActivities());
}

function renderKpiSelection() {
  const selectedMetric = getSelectedDashboardMetric();
  for (const card of els.kpiCards) {
    const selected = card.dataset.kpiMetric === selectedMetric.key;
    card.classList.toggle("selected", selected);
    card.setAttribute("aria-pressed", String(selected));
  }
}

function getSelectedDashboardMetric() {
  return DASHBOARD_METRICS[appState.selectedKpiMetric] || DASHBOARD_METRICS[DEFAULT_DASHBOARD_METRIC_KEY];
}

function setActiveViewTab(view) {
  for (const item of els.viewTabs || []) {
    item.classList.toggle("active", item.dataset.view === view);
  }
}

function renderView() {
  const showActivityList = appState.currentView === "dashboard" && appState.activityListOpen;
  els.dashboardView.classList.toggle("hidden", appState.currentView !== "dashboard" || showActivityList);
  els.activityListView.classList.toggle("hidden", !showActivityList);
  els.pbView.classList.toggle("hidden", appState.currentView !== "pb");
  els.timeView.classList.toggle("hidden", appState.currentView !== "time");
  els.analysisView.classList.toggle("hidden", appState.currentView !== "analysis");
  els.analysisRankControl.classList.toggle("hidden", appState.currentView !== "analysis");
}

function renderCharts(activities) {
  renderCumulativeMetricChart(appState.activities);
  renderWeeklyMetricChart(activities);
  renderDistanceDistributionChart(activities);
}

function renderCumulativeMetricChart(activities) {
  const metric = getSelectedDashboardMetric();
  els.cumulativeMetricTitle.textContent = metric.chartTitle;
  const analysis = buildCumulativeMetricAnalysis(activities, metric);
  if (!analysis || !analysis.series.some((item) => item.points.length)) {
    els.cumulativeDistanceCaption.textContent = "No data";
    return renderEmpty(els.cumulativeDistanceChart, metric.noDataLabel);
  }

  const width = 980;
  const height = 318;
  const padding = { top: 54, right: 28, bottom: 48, left: 62 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const allPoints = analysis.series.flatMap((item) => item.points);
  const maxValue = Math.max(...allPoints.map((point) => point.cumulativeValue), 0);
  const yMax = getMetricYMax(maxValue, metric);
  const xMax = Math.max(analysis.pointCount - 1, 1);
  const x = (offset) => padding.left + (offset / xMax) * chartWidth;
  const y = (value) => padding.top + chartHeight - (value / yMax) * chartHeight;
  const xTicks = getCumulativeDateTickOffsets(analysis.pointCount);
  const yTicks = getMetricYTicks(yMax, metric);

  const grid = [
    ...xTicks.map((offset) => {
      const tickX = x(offset);
      const date = analysis.tickDates[offset] || null;
      return `
        <line x1="${tickX}" x2="${tickX}" y1="${padding.top}" y2="${height - padding.bottom}" stroke="#e5e9e3"></line>
        <text class="axis-label" x="${tickX}" y="${height - 18}" text-anchor="middle">${formatShortDate(date)}</text>
      `;
    }),
    ...yTicks.map((tick) => {
      const tickY = y(tick);
      return `
        <line x1="${padding.left}" x2="${width - padding.right}" y1="${tickY}" y2="${tickY}" stroke="#d9dfd7"></line>
        <text class="axis-label" x="8" y="${tickY + 4}">${metric.formatAxisValue(tick)}</text>
      `;
    })
  ].join("");

  const lines = analysis.series.map((item) => {
    if (!item.points.length) return "";
    const path = item.points
      .map((point, index) => `${index ? "L" : "M"} ${x(point.offset).toFixed(1)} ${y(point.cumulativeValue).toFixed(1)}`)
      .join(" ");
    const dashAttribute = item.dashArray ? ` stroke-dasharray="${item.dashArray}"` : "";
    const dots = item.points
      .filter((point, index) => shouldShowCumulativeDot(index, item.points.length))
      .map((point) => `
        <circle cx="${x(point.offset).toFixed(1)}" cy="${y(point.cumulativeValue).toFixed(1)}" r="3.6" fill="${item.dotFill || item.color}" stroke="${item.color}" stroke-width="1.6" data-tooltip="${escapeHtml(`${item.label}\n${formatDate(point.date)}\nCumulative ${metric.formatValue(point.cumulativeValue)} · Day ${metric.formatValue(point.value)}`)}"></circle>
      `).join("");
    return `
      <path d="${path}" fill="none" stroke="${item.color}" stroke-width="${item.strokeWidth || 3}"${dashAttribute} stroke-linecap="round" stroke-linejoin="round"></path>
      ${dots}
    `;
  }).join("");

  const legend = analysis.series.map((item, index) => {
    const xPosition = padding.left + index * 150;
    const dashAttribute = item.dashArray ? ` stroke-dasharray="${item.dashArray}"` : "";
    return `
      <g transform="translate(${xPosition}, 20)">
        <line x1="0" x2="24" y1="0" y2="0" stroke="${item.color}" stroke-width="${item.strokeWidth || 3}"${dashAttribute}></line>
        <text class="axis-label" x="30" y="4">${item.label}</text>
      </g>
    `;
  }).join("");

  els.cumulativeDistanceCaption.textContent = "";
  els.cumulativeDistanceChart.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(analysis.ariaLabel)}">
      ${grid}
      ${legend}
      ${lines}
    </svg>
  `;
}

function buildCumulativeMetricAnalysis(activities, metric) {
  const runs = activities
    .filter(isRun)
    .map((activity) => ({
      date: getActivityLocalDay(activity),
      value: metric.getValue(activity)
    }))
    .filter((activity) => activity.date && Number.isFinite(activity.value));
  if (!runs.length) return null;

  const dailyValues = buildDailyMetricMap(runs);
  const selectedLabel = selectedRangeLabel();
  if (appState.rangeDays === "all") {
    const dates = runs.map((activity) => activity.date).sort((a, b) => a - b);
    const start = dates[0];
    const end = dates.at(-1);
    const points = buildCumulativeMetricPoints(dailyValues, start, end);
    const total = points.at(-1)?.cumulativeValue || 0;
    return {
      caption: `All time · ${metric.formatValue(total)} · ${formatDate(start)} - ${formatDate(end)}`,
      ariaLabel: `All-time ${metric.axisLabel} by date`,
      pointCount: points.length,
      tickDates: points.map((point) => point.date),
      series: [{
        key: "current",
        label: "All time",
        color: "#24724f",
        points
      }]
    };
  }

  const rangeDays = Number(appState.rangeDays);
  if (!Number.isFinite(rangeDays) || rangeDays <= 0) return null;
  const currentRange = getDashboardDateRange(appState.activities);
  const previousRange = getPreviousDashboardDateRange(currentRange);
  if (!currentRange || !previousRange) return null;
  const currentPoints = buildCumulativeMetricPoints(dailyValues, currentRange.start, currentRange.end);
  const previousPoints = buildCumulativeMetricPoints(dailyValues, previousRange.start, previousRange.end);
  const currentTotal = currentPoints.at(-1)?.cumulativeValue || 0;
  const previousTotal = previousPoints.at(-1)?.cumulativeValue || 0;
  const delta = currentTotal - previousTotal;

  return {
    caption: `${selectedLabel} ${metric.formatValue(currentTotal)} · Previous ${metric.formatValue(previousTotal)} · ${metric.formatDelta(delta)}`,
    ariaLabel: `${selectedLabel} vs previous matching range ${metric.axisLabel} by date`,
    pointCount: currentPoints.length,
    tickDates: currentPoints.map((point) => point.date),
    series: [
      {
        key: "current",
        label: "Selected",
        color: "#24724f",
        points: currentPoints
      },
      {
        key: "previous",
        label: "Previous",
        color: "#3266a8",
        dashArray: "8 6",
        strokeWidth: 2.6,
        dotFill: "#ffffff",
        points: previousPoints
      }
    ]
  };
}

function buildDailyMetricMap(runs) {
  const map = new Map();
  for (const run of runs) {
    const key = localDateKey(run.date);
    map.set(key, (map.get(key) || 0) + run.value);
  }
  return map;
}

function buildCumulativeMetricPoints(dailyValues, start, end) {
  const totalDays = daysBetweenLocalDates(start, end) + 1;
  let cumulativeValue = 0;
  return Array.from({ length: totalDays }, (_, offset) => {
    const date = addLocalDays(start, offset);
    const value = dailyValues.get(localDateKey(date)) || 0;
    cumulativeValue += value;
    return {
      offset,
      date,
      value,
      cumulativeValue
    };
  });
}

function getMetricYMax(value, metric) {
  if (!Number.isFinite(value) || value <= 0) return 1;
  const compactStep = value <= 10 ? 1 : 10;
  const step = metric.key === "elevation" ? (value <= 100 ? 10 : 100) : compactStep;
  return Math.max(Math.ceil(value / step) * step, 1);
}

function getMetricYTicks(yMax, metric) {
  const middle = metric.key === "activities" ? Math.ceil(yMax / 2) : yMax / 2;
  return Array.from(new Set([0, middle, yMax])).sort((a, b) => a - b);
}

function getActivityLocalDay(activity) {
  const date = getLocalFirstDate(activity.start_date_local, activity.start_date);
  return date ? startOfLocalDay(date) : null;
}

function addLocalDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return startOfLocalDay(next);
}

function daysBetweenLocalDates(start, end) {
  return Math.max(0, Math.round((startOfLocalDay(end) - startOfLocalDay(start)) / DAY_MS));
}

function localDateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function getCumulativeDateTickOffsets(pointCount) {
  if (pointCount <= 8) {
    return Array.from({ length: pointCount }, (_, index) => index);
  }
  if (pointCount <= 31) {
    const offsets = new Set([0, pointCount - 1]);
    for (let index = 4; index < pointCount - 1; index += 5) offsets.add(index);
    return Array.from(offsets).sort((a, b) => a - b);
  }
  return [0, Math.floor((pointCount - 1) / 2), pointCount - 1];
}

function shouldShowCumulativeDot(index, total) {
  if (total <= 31) return true;
  return index === 0 || index === total - 1;
}

function renderWeeklyMetricChart(activities) {
  const metric = getSelectedDashboardMetric();
  els.primaryDistanceTitle.textContent = `Weekly ${metric.valueLabel}`;
  els.monthlyChart.setAttribute("aria-label", `Weekly ${metric.valueLabel} chart`);
  const weeks = groupByWeek(activities, metric);
  const range = getDashboardDateRange(activities);
  const previousRange = getPreviousDashboardDateRange();
  const previousWeeks = previousRange
    ? groupByWeek(getActivitiesInDateRange(previousRange), metric, previousRange)
    : [];
  const maxVisibleLabels = els.monthlyChart.clientWidth < 700 ? 6 : 8;
  const labelEvery = weeks.length <= maxVisibleLabels ? 1 : Math.ceil(weeks.length / maxVisibleLabels);
  els.monthlyCaption.textContent = "";
  return renderMetricBucketBarChart({
    container: els.monthlyChart,
    width: 760,
    metric,
    ariaLabel: `Weekly ${metric.valueLabel}`,
    emptyText: `No weekly ${metric.valueLabel} data`,
    items: weeks.map((item, index) => ({
      label: formatWeekBucketLabel(item, range),
      shortLabel: item.shortLabel,
      value: item.value,
      count: item.count,
      showLabel: index === 0 || index === weeks.length - 1 || index % labelEvery === 0,
      tooltip: formatMetricBucketTooltip(formatWeekBucketLabel(item, range), item.value, item.count, metric)
    })),
    lineItems: previousWeeks.map((item) => ({
      value: item.value,
      tooltip: formatMetricBucketTooltip(`Previous range ${formatWeekBucketLabel(item, previousRange)}`, item.value, item.count, metric)
    }))
  });
}

function formatWeekBucketLabel(item, range) {
  if (!range) return item.label;
  const start = item.start < range.start ? range.start : item.start;
  const end = item.end > range.end ? range.end : item.end;
  return `${formatShortDate(start)} - ${formatShortDate(end)}`;
}

function renderMetricBucketBarChart({ container, width, metric, ariaLabel, emptyText, items, lineItems = [] }) {
  const maxValue = Math.max(...items.map((item) => item.value), ...lineItems.map((item) => item.value), 0);
  if (!items.length || !maxValue) return renderEmpty(container, emptyText);

  const height = 258;
  const hasPreviousLine = lineItems.length > 0;
  const padding = { top: hasPreviousLine ? 48 : 24, right: 18, bottom: 38, left: 48 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const chartMaxValue = getMetricYMax(maxValue, metric);
  const barGap = items.length > 72 ? 1 : items.length > 24 ? 3 : 8;
  const barWidth = Math.max(1.5, (chartWidth - barGap * (items.length - 1)) / items.length);

  const bars = items.map((item, index) => {
    const barHeight = (item.value / chartMaxValue) * chartHeight;
    const x = padding.left + index * (barWidth + barGap);
    const y = padding.top + chartHeight - barHeight;
    const fill = item.value ? (index % 2 ? "#3266a8" : "#24724f") : "#eef2ed";
    const label = item.showLabel
      ? `<text class="axis-label" x="${(x + barWidth / 2).toFixed(1)}" y="${height - 14}" text-anchor="middle">${item.shortLabel}</text>`
      : "";
    return `
      <rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${Math.max(0, barHeight).toFixed(1)}" fill="${fill}" data-tooltip="${escapeHtml(item.tooltip)}"></rect>
      ${label}
    `;
  }).join("");
  const line = renderBucketOverlayLine({
    items: lineItems,
    count: items.length,
    xForIndex: (index) => padding.left + index * (barWidth + barGap) + barWidth / 2,
    yForValue: (value) => padding.top + chartHeight - (value / chartMaxValue) * chartHeight
  });
  const gridRatios = [0, 0.5, 1];
  const grid = gridRatios.map((ratio) => {
    const y = padding.top + chartHeight - ratio * chartHeight;
    return `
      <line x1="${padding.left}" x2="${width - padding.right}" y1="${y}" y2="${y}" stroke="#d9dfd7"></line>
      <text class="axis-label" x="8" y="${y + 4}">${metric.formatAxisValue(chartMaxValue * ratio)}</text>
    `;
  }).join("");

  container.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(ariaLabel)}">
      ${hasPreviousLine ? renderPreviousPeriodLegend(padding.left, 16) : ""}
      ${grid}
      ${bars}
      ${line}
    </svg>
  `;
}

function renderBucketOverlayLine({ items, count, xForIndex, yForValue }) {
  if (!items.length || !count) return "";
  const points = items.slice(0, count).map((item, index) => ({
    ...item,
    x: xForIndex(index),
    y: yForValue(item.value)
  }));
  if (!points.length) return "";
  const path = points.map((point, index) => `${index ? "L" : "M"} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(" ");
  const circles = points.map((point) => `
    <circle cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="3.8" fill="#ffffff" stroke="#c7672f" stroke-width="2" data-tooltip="${escapeHtml(point.tooltip)}"></circle>
  `).join("");
  return `
    <path d="${path}" fill="none" stroke="#c7672f" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"></path>
    ${circles}
  `;
}

function renderPreviousPeriodLegend(x, y) {
  return `
    <g transform="translate(${x}, ${y})">
      <line x1="0" x2="24" y1="0" y2="0" stroke="#c7672f" stroke-width="2.6" stroke-linecap="round"></line>
      <circle cx="24" cy="0" r="3.8" fill="#ffffff" stroke="#c7672f" stroke-width="2"></circle>
      <text class="axis-label" x="36" y="4">Previous</text>
    </g>
  `;
}

function formatMetricBucketTooltip(label, value, count, metric) {
  const activityCount = formatInteger(count);
  if (metric.key === "activities") return `${label}\n${metric.formatValue(value)}`;
  return `${label}\n${metric.formatValue(value)} · ${activityCount} activities`;
}

function renderDistanceDistributionChart(activities) {
  const runs = activities
    .filter(isRun)
    .map((activity) => ({
      name: activity.name || "Untitled",
      date: getActivityLocalDay(activity),
      distanceKm: Number(activity.distance || 0) / 1000
    }))
    .filter((activity) => Number.isFinite(activity.distanceKm) && activity.distanceKm > 0);

  if (!runs.length) {
    els.distanceDistributionCaption.textContent = "No data";
    return renderEmpty(els.distanceDistributionChart, "No distance distribution data");
  }

  const bins = buildDistanceDistributionBins(runs);
  const previousRange = getPreviousDashboardDateRange();
  const previousBins = previousRange
    ? buildDistanceDistributionBins(getActivitiesInDateRange(previousRange)
      .map((activity) => ({
        name: activity.name || "Untitled",
        date: getActivityLocalDay(activity),
        distanceKm: Number(activity.distance || 0) / 1000
      }))
      .filter((activity) => Number.isFinite(activity.distanceKm) && activity.distanceKm > 0))
    : [];
  const maxCount = Math.max(...bins.map((bin) => bin.count), ...previousBins.map((bin) => bin.count), 0);
  els.distanceDistributionCaption.textContent = "";

  const width = 760;
  const height = 258;
  const hasPreviousLine = previousBins.length > 0;
  const padding = { top: hasPreviousLine ? 48 : 24, right: 18, bottom: 38, left: 42 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const yMax = Math.max(maxCount, 1);
  const barGap = 8;
  const barWidth = Math.max(10, (chartWidth - barGap * (bins.length - 1)) / bins.length);

  const bars = bins.map((bin, index) => {
    const barHeight = (bin.count / yMax) * chartHeight;
    const x = padding.left + index * (barWidth + barGap);
    const y = padding.top + chartHeight - barHeight;
    return `
      <rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${Math.max(0, barHeight).toFixed(1)}" fill="${index % 2 ? "#3266a8" : "#24724f"}" data-tooltip="${escapeHtml(`${bin.label}\n${formatInteger(bin.count)} activities · avg ${formatNumber(bin.averageKm, 1)} km`)}"></rect>
      <text class="axis-label" x="${(x + barWidth / 2).toFixed(1)}" y="${height - 14}" text-anchor="middle">${bin.shortLabel}</text>
    `;
  }).join("");
  const line = renderBucketOverlayLine({
    items: previousBins.map((bin) => ({
      value: bin.count,
      tooltip: `Previous range ${bin.label}\n${formatInteger(bin.count)} activities · avg ${formatNumber(bin.averageKm, 1)} km`
    })),
    count: bins.length,
    xForIndex: (index) => padding.left + index * (barWidth + barGap) + barWidth / 2,
    yForValue: (value) => padding.top + chartHeight - (value / yMax) * chartHeight
  });
  const gridRatios = [0, 0.5, 1];
  const grid = gridRatios.map((ratio) => {
    const y = padding.top + chartHeight - ratio * chartHeight;
    const count = Math.round(yMax * ratio);
    return `
      <line x1="${padding.left}" x2="${width - padding.right}" y1="${y}" y2="${y}" stroke="#d9dfd7"></line>
      <text class="axis-label" x="8" y="${y + 4}">${formatInteger(count)}</text>
    `;
  }).join("");

  els.distanceDistributionChart.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Activity distance distribution for selected range">
      ${hasPreviousLine ? renderPreviousPeriodLegend(padding.left, 16) : ""}
      ${grid}
      ${bars}
      ${line}
    </svg>
  `;
}

function buildDistanceDistributionBins(runs) {
  const bins = DISTANCE_DISTRIBUTION_BINS.map((bin) => ({
    ...bin,
    count: 0,
    totalKm: 0,
    averageKm: 0
  }));

  for (const run of runs) {
    const index = bins.findIndex((bin) => run.distanceKm >= bin.min && run.distanceKm < bin.max);
    bins[index].count += 1;
    bins[index].totalKm += run.distanceKm;
  }

  for (const bin of bins) {
    bin.averageKm = bin.count ? bin.totalKm / bin.count : 0;
  }

  return bins;
}

function renderLongRuns(activities) {
  const top = [...activities].sort((a, b) => Number(b.distance || 0) - Number(a.distance || 0)).slice(0, 5);
  els.longRunCaption.textContent = "";
  if (!top.length) {
    els.longRunList.innerHTML = `<li class="chart-empty">No runs</li>`;
    return;
  }

  els.longRunList.innerHTML = top.map((activity, index) => `
    <li class="ranking-item">
      <span class="rank">${index + 1}</span>
      <span>
        <span class="ranking-title">${escapeHtml(activity.name || "Untitled")}</span>
        <span class="ranking-meta">${formatDate(activity.start_date_local || activity.start_date)} · ${formatPaceForActivity(activity)}</span>
      </span>
      <strong class="ranking-value">${formatNumber(Number(activity.distance || 0) / 1000, 1)} km</strong>
    </li>
  `).join("");
}

function renderTable(activities) {
  const rows = activities.slice(0, RECENT_ACTIVITY_LIMIT);
  els.recentCaption.textContent = "";
  if (!rows.length) {
    els.activityTable.innerHTML = `<tr><td colspan="6">No saved activities</td></tr>`;
    return;
  }

  els.activityTable.innerHTML = rows.map((activity) => `
    <tr>
      <td>${formatDate(activity.start_date_local || activity.start_date)}</td>
      <td class="activity-name">${escapeHtml(activity.name || "Untitled")}</td>
      <td>${escapeHtml(formatSport(activity))}</td>
      <td>${formatNumber(Number(activity.distance || 0) / 1000, 2)} km</td>
      <td>${formatPaceForActivity(activity)}</td>
      <td>${formatDuration(activity.moving_time || 0)}</td>
    </tr>
  `).join("");
}

function renderAllActivities() {
  if (els.allActivitySearchInput && document.activeElement !== els.allActivitySearchInput) {
    els.allActivitySearchInput.value = appState.allActivitySearch || "";
  }
  if (els.allActivityRunOnlyInput) {
    els.allActivityRunOnlyInput.checked = Boolean(appState.allActivityRunOnly);
  }
  if (els.allActivityDetailStatusSelect) {
    els.allActivityDetailStatusSelect.value = appState.allActivityDetailStatus || "all";
  }

  updateAllActivitySortButtons();
  const rows = getVisibleAllActivities();
  els.allActivityCountCaption.textContent = `${formatInteger(rows.length)} shown · ${formatInteger(appState.activities.length)} saved`;
  if (!rows.length) {
    els.allActivityTable.innerHTML = `<tr><td colspan="10">No matching activities</td></tr>`;
    return;
  }

  els.allActivityTable.innerHTML = rows.map((activity) => {
    const activityId = String(activity.id || "").trim();
    const canRefresh = activityId && isRun(activity);
    const isRefreshing = activityId && activityId === appState.refreshingActivityId;
    const activityName = activity.name || "Untitled";
    const refreshLabel = isRefreshing ? "Refreshing" : "Refresh Activity";
    const refreshAriaLabel = isRefreshing ? `Refreshing ${activityName}` : `Refresh ${activityName}`;
    const action = canRefresh
      ? `<button class="button ghost personal-best-refresh${isRefreshing ? " is-refreshing" : ""}" type="button" data-refresh-activity-id="${escapeHtml(activityId)}" aria-label="${escapeHtml(refreshAriaLabel)}" title="${escapeHtml(refreshLabel)}"${isRefreshing ? " disabled" : ""}>${renderRefreshIcon()}</button>`
      : "";
    return `
      <tr>
        <td>${formatDate(activity.start_date_local || activity.start_date)}</td>
        <td class="activity-name">${escapeHtml(activityName)}</td>
        <td>${escapeHtml(formatSport(activity))}</td>
        <td>${formatNumber(Number(activity.distance || 0) / 1000, 2)} km</td>
        <td>${formatPaceForActivity(activity)}</td>
        <td>${formatDuration(activity.moving_time || 0)}</td>
        <td>${formatElevationCell(activity.total_elevation_gain)}</td>
        <td>${formatHeartRateCell(activity.average_heartrate)}</td>
        <td>${renderActivityDetailStatus(activity)}</td>
        <td>${action}</td>
      </tr>
    `;
  }).join("");
}

function getVisibleAllActivities() {
  const query = String(appState.allActivitySearch || "").trim().toLowerCase();
  const detailStatus = appState.allActivityDetailStatus || "all";
  return [...appState.activities]
    .filter((activity) => {
      if (appState.allActivityRunOnly && !isRun(activity)) return false;
      if (detailStatus !== "all" && activity.detail_status !== detailStatus) return false;
      if (!query) return true;
      return [
        activity.id,
        activity.name,
        activity.type,
        activity.sport_type,
        activity.start_date_local,
        activity.start_date
      ].some((value) => String(value || "").toLowerCase().includes(query));
    })
    .sort(compareAllActivities);
}

function compareAllActivities(a, b) {
  const sort = appState.allActivitySort || { key: "date", direction: "desc" };
  const aValue = getAllActivitySortValue(a, sort.key);
  const bValue = getAllActivitySortValue(b, sort.key);
  const aMissing = isMissingSortValue(aValue);
  const bMissing = isMissingSortValue(bValue);
  if (aMissing || bMissing) {
    if (aMissing && bMissing) return compareAllActivityDatesDesc(a, b);
    return aMissing ? 1 : -1;
  }

  let comparison = typeof aValue === "string" || typeof bValue === "string"
    ? String(aValue).localeCompare(String(bValue))
    : Number(aValue) - Number(bValue);
  if (!comparison) return compareAllActivityDatesDesc(a, b);
  return sort.direction === "desc" ? -comparison : comparison;
}

function getAllActivitySortValue(activity, key) {
  if (key === "name") return activity.name || "";
  if (key === "sport") return formatSport(activity);
  if (key === "distance") return Number(activity.distance);
  if (key === "pace") {
    const distanceKm = Number(activity.distance || 0) / 1000;
    const movingTime = Number(activity.moving_time || 0);
    return distanceKm && movingTime ? movingTime / distanceKm : null;
  }
  if (key === "moving_time") return Number(activity.moving_time);
  if (key === "elevation") return Number(activity.total_elevation_gain);
  if (key === "avg_hr") return Number(activity.average_heartrate);
  if (key === "detail_status") return detailStatusSortRank(activity.detail_status);
  return getActivityStartTime(activity);
}

function isMissingSortValue(value) {
  if (value === null || value === undefined || value === "") return true;
  if (typeof value === "number" && !Number.isFinite(value)) return true;
  return false;
}

function compareAllActivityDatesDesc(a, b) {
  return getActivityStartTime(b) - getActivityStartTime(a);
}

function detailStatusSortRank(status) {
  return {
    failed: 0,
    missing: 1,
    fetched: 2,
    not_applicable: 3
  }[status] ?? 4;
}

function toggleAllActivitySort(key) {
  if (!key) return;
  const current = appState.allActivitySort || { key: "date", direction: "desc" };
  if (current.key === key) {
    appState.allActivitySort = {
      key,
      direction: current.direction === "asc" ? "desc" : "asc"
    };
    return;
  }
  appState.allActivitySort = {
    key,
    direction: key === "date" ? "desc" : "asc"
  };
}

function updateAllActivitySortButtons() {
  const sort = appState.allActivitySort || { key: "date", direction: "desc" };
  for (const button of els.allActivitySortButtons || []) {
    const label = button.dataset.sortLabel || button.textContent.replace(/[ ▲▼]$/, "");
    button.dataset.sortLabel = label;
    const active = button.dataset.activitySort === sort.key;
    button.classList.toggle("active", active);
    button.textContent = active ? `${label} ${sort.direction === "asc" ? "▲" : "▼"}` : label;
    button.setAttribute("aria-sort", active ? sort.direction : "none");
  }
}

function renderActivityDetailStatus(activity) {
  const status = activity.detail_status || "missing";
  const label = formatActivityDetailStatus(status, activity.best_effort_count);
  const detail = activity.details_fetch_error?.message || activity.details_fetched_at || activity.details_fetch_failed_at || "";
  return `<span class="detail-status detail-status--${escapeHtml(status)}" title="${escapeHtml(detail)}">${escapeHtml(label)}</span>`;
}

function formatActivityDetailStatus(status, bestEffortCount = 0) {
  if (status === "fetched") return `Fetched${bestEffortCount ? ` · ${formatInteger(bestEffortCount)}` : ""}`;
  if (status === "failed") return "Failed";
  if (status === "not_applicable") return "-";
  return "Missing";
}

function formatElevationCell(value) {
  const number = Number(value);
  return Number.isFinite(number) ? `${formatInteger(Math.round(number))} m` : "-";
}

function formatHeartRateCell(value) {
  const number = Number(value);
  return Number.isFinite(number) ? `${formatInteger(Math.round(number))}` : "-";
}

function handleAllActivityAction(event) {
  if (!(event.target instanceof Element)) return;
  const refreshButton = event.target.closest("[data-refresh-activity-id]");
  if (!refreshButton || !els.allActivityTable.contains(refreshButton)) return;
  refreshActivityDetail(refreshButton.dataset.refreshActivityId);
}

function renderPersonalBests() {
  const payload = appState.personalBests;
  const distances = payload?.distances || [];
  if (els.personalBestCaption) {
    els.personalBestCaption.textContent = distances.length
      ? `${formatInteger(payload.detailActivityCount || 0)} activities · ${formatInteger(payload.effortCount || 0)} best efforts`
      : "No data";
  }

  if (!distances.length) {
    els.personalBestGrid.innerHTML = `<div class="chart-empty">No best effort data</div>`;
    return;
  }

  els.personalBestGrid.innerHTML = distances.map((distance) => {
    const topEfforts = distance.top || [];
    const isExpanded = appState.expandedPersonalBestDistances.has(distance.name);
    const visibleLimit = isExpanded ? PERSONAL_BEST_EXPANDED_LIMIT : PERSONAL_BEST_DEFAULT_LIMIT;
    const visibleEfforts = topEfforts.slice(0, visibleLimit);
    const rows = visibleEfforts.length ? visibleEfforts.map((effort, index) => {
      const activityName = effort.activityName || "Untitled";
      const exclusionButton = renderRecordExclusionButton(effort, activityName);
      return `
        <tr${effort.excluded ? ` class="record-row-excluded"` : ""}>
          <td>${index + 1}</td>
          <td>${formatDate(effort.startDateLocal || effort.startDate)}</td>
          <td class="activity-name">${escapeHtml(activityName)}</td>
          <td>${formatClockDuration(effort.movingTime)}</td>
          <td>${formatPaceWithUnit(effort.paceSecondsPerKm)}</td>
          <td>${exclusionButton}</td>
        </tr>
      `;
    }).join("") : `<tr><td colspan="6">No best efforts</td></tr>`;
    const hasMore = topEfforts.length > PERSONAL_BEST_DEFAULT_LIMIT;
    const toggleLabel = isExpanded ? "Show Less" : "Show More";
    const toggleMeta = isExpanded
      ? `Showing top ${visibleEfforts.length}`
      : `Showing top ${PERSONAL_BEST_DEFAULT_LIMIT}`;
    const toggle = hasMore ? `
      <div class="personal-best-more-row">
        <span>${toggleMeta}</span>
        <button class="button ghost personal-best-more" type="button" data-personal-best-toggle="${escapeHtml(distance.name)}">
          ${toggleLabel}
        </button>
      </div>
    ` : "";

    return `
      <article class="records-panel personal-best-panel">
        <div class="panel-title">
          <h2>${escapeHtml(distance.name)}</h2>
          <span>${formatInteger(distance.count || 0)} best efforts</span>
        </div>
        <div class="table-wrap personal-best-table">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Date</th>
                <th>Activity</th>
                <th>Best Time</th>
                <th>Pace</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
        ${toggle}
      </article>
    `;
  }).join("");
}

function renderTimeBestsView() {
  const payload = appState.personalBests || {};
  renderTimeBestDistanceChart();
  renderTimeBestRecencyChart();
  renderTimeBestTrendChart();
  renderTimeLimitedBests(payload.durations || [], payload);
}

function renderTimeLimitedBests(durations, payload = {}) {
  if (!els.personalBestDurationGrid) return;
  if (els.personalBestDurationCaption) {
    els.personalBestDurationCaption.textContent = durations.length
      ? `${formatInteger(payload.durationActivityCount || 0)} stream activities · ${formatInteger(payload.durationEffortCount || 0)} time bests`
      : "No stream data";
  }

  if (!durations.length) {
    els.personalBestDurationGrid.innerHTML = `<div class="chart-empty">No time-limited best data</div>`;
    return;
  }

  els.personalBestDurationGrid.innerHTML = durations.map((duration) => {
    const topEfforts = duration.top || [];
    const isExpanded = appState.expandedTimeBestDurations.has(duration.name);
    const visibleLimit = isExpanded ? PERSONAL_BEST_EXPANDED_LIMIT : PERSONAL_BEST_DEFAULT_LIMIT;
    const visibleEfforts = topEfforts.slice(0, visibleLimit);
    const rows = visibleEfforts.map((effort, index) => {
      const activityName = effort.activityName || "Untitled";
      const exclusionButton = renderRecordExclusionButton(effort, activityName);
      return `
        <tr${effort.excluded ? ` class="record-row-excluded"` : ""}>
          <td>${index + 1}</td>
          <td>${formatDate(effort.startDateLocal || effort.startDate)}</td>
          <td class="activity-name">${escapeHtml(activityName)}</td>
          <td>${formatNumber(Number(effort.distanceKm || 0), 2)} km</td>
          <td>${formatPaceWithUnit(effort.paceSecondsPerKm)}</td>
          <td>${formatClockDuration(effort.startOffset || 0)}</td>
          <td>${exclusionButton}</td>
        </tr>
      `;
    }).join("") || `<tr><td colspan="7">No time bests</td></tr>`;
    const hasMore = topEfforts.length > PERSONAL_BEST_DEFAULT_LIMIT;
    const toggleLabel = isExpanded ? "Show Less" : "Show More";
    const toggleMeta = isExpanded
      ? `Showing top ${visibleEfforts.length}`
      : `Showing top ${PERSONAL_BEST_DEFAULT_LIMIT}`;
    const toggle = hasMore ? `
      <div class="personal-best-more-row">
        <span>${toggleMeta}</span>
        <button class="button ghost personal-best-more" type="button" data-time-best-toggle="${escapeHtml(duration.name)}">
          ${toggleLabel}
        </button>
      </div>
    ` : "";

    return `
      <article class="records-panel personal-best-panel">
        <div class="panel-title">
          <h2>${escapeHtml(duration.name)}</h2>
          <span>${formatInteger(duration.count || 0)} ${Number(duration.count || 0) === 1 ? "window" : "windows"}</span>
        </div>
        <div class="table-wrap personal-best-table time-best-table">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Date</th>
                <th>Activity</th>
                <th>Distance</th>
                <th>Pace</th>
                <th>Start</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
        ${toggle}
      </article>
    `;
  }).join("");
}

function renderTimeBestDistanceChart() {
  if (!els.timeBestDistanceChart) return;
  for (const button of els.timeBestScaleButtons || []) {
    button.classList.toggle("active", button.dataset.scale === appState.timeBestScale);
  }
  const durations = appState.personalBests?.durations || [];
  const series = buildTimeBestDistanceSeries();
  const values = series.flatMap((item) => item.points.map((point) => point.paceSecondsPerKm));
  const durationValues = series.flatMap((item) => item.points.map((point) => point.durationSeconds));
  const minDuration = Math.min(...durationValues);
  const maxDuration = Math.max(...durationValues);
  if (!values.length || !Number.isFinite(minDuration) || !Number.isFinite(maxDuration) || !maxDuration) {
    els.timeBestDistanceChartCaption.textContent = "No data";
    return renderEmpty(els.timeBestDistanceChart, "No time best pace data");
  }

  const useLogScale = appState.timeBestScale === "log" && minDuration > 0 && maxDuration > minDuration;
  els.timeBestDistanceChartCaption.textContent = "";
  const width = 980;
  const height = 318;
  const padding = { top: 24, right: 28, bottom: 58, left: 62 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const paceDomain = buildPaceAxisDomain(values);
  const xMin = useLogScale ? minDuration : 0;
  const xMax = useLogScale ? maxDuration : Math.max(maxDuration, durations.at(-1)?.durationSeconds || maxDuration);
  const logMin = useLogScale ? Math.log(xMin) : 0;
  const logSpread = useLogScale ? Math.max(Math.log(xMax) - logMin, 0.0001) : 1;
  const x = (durationSeconds) => {
    if (!useLogScale) return padding.left + (durationSeconds / xMax) * chartWidth;
    return padding.left + ((Math.log(durationSeconds) - logMin) / logSpread) * chartWidth;
  };
  const y = (pace) => padding.top + ((pace - paceDomain.min) / paceDomain.spread) * chartHeight;
  const xTicks = getTimeBestDurationTicks({ useLogScale, minDuration, maxDuration, xMax, durations });
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((ratio) => paceDomain.min + ratio * paceDomain.spread);

  const grid = [
    ...xTicks.map((duration) => {
      const tickX = x(duration.durationSeconds);
      return `
        <line x1="${tickX}" x2="${tickX}" y1="${padding.top}" y2="${height - padding.bottom}" stroke="#e5e9e3"></line>
        <text class="axis-label" x="${tickX}" y="${height - 22}" text-anchor="middle">${escapeHtml(formatTimeBestTick(duration))}</text>
      `;
    }),
    ...yTicks.map((tick) => {
      const tickY = y(tick);
      return `
        <line x1="${padding.left}" x2="${width - padding.right}" y1="${tickY}" y2="${tickY}" stroke="#d9dfd7"></line>
        <text class="axis-label" x="10" y="${tickY + 4}">${formatPace(tick)}</text>
      `;
    })
  ].join("");

  const lines = series.map((item) => {
    if (item.points.length < 2) return "";
    const path = item.points
      .map((point, index) => `${index ? "L" : "M"} ${x(point.durationSeconds).toFixed(1)} ${y(point.paceSecondsPerKm).toFixed(1)}`)
      .join(" ");
    const dashAttribute = item.dashArray ? ` stroke-dasharray="${item.dashArray}"` : "";
    const strokeWidth = item.strokeWidth || 3;
    const dots = item.points.map((point) => `
      <circle cx="${x(point.durationSeconds)}" cy="${y(point.paceSecondsPerKm)}" r="${item.dotRadius || 4}" fill="${item.dotFill || item.color}" stroke="${item.dotStroke || item.color}" stroke-width="${item.dotStrokeWidth || 0}" data-tooltip="${escapeHtml(formatTimeBestPaceTooltip(item, point))}"></circle>
    `).join("");
    return `
      <path d="${path}" fill="none" stroke="${item.color}" stroke-width="${strokeWidth}"${dashAttribute} stroke-linecap="round" stroke-linejoin="round"></path>
      ${dots}
    `;
  }).join("");

  const legend = series.map((item, index) => {
    const xPosition = padding.left + 36 + index * 112;
    const dashAttribute = item.dashArray ? ` stroke-dasharray="${item.dashArray}"` : "";
    return `
      <g transform="translate(${xPosition}, 10)">
        <line x1="0" x2="22" y1="0" y2="0" stroke="${item.color}" stroke-width="${item.strokeWidth || 3}"${dashAttribute}></line>
        <text class="axis-label" x="28" y="4">${item.label}</text>
      </g>
    `;
  }).join("");

  els.timeBestDistanceChart.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Top 1, top 3, top 10, and median pace by time">
      ${grid}
      <text class="axis-label" x="${padding.left + chartWidth / 2}" y="${height - 4}" text-anchor="middle">Time</text>
      <text class="axis-label" x="10" y="16">Pace</text>
      ${legend}
      ${lines}
    </svg>
  `;
}

function renderTimeBestRecencyChart() {
  if (!els.timeBestRecencyChart) return;
  const newestSeries = buildTimeBestRecencySeries("newest");
  const oldestSeries = buildTimeBestRecencySeries("oldest");
  const series = [...oldestSeries, ...newestSeries];
  const datedSeries = series.map((item) => ({
    ...item,
    points: item.points
      .map((point) => {
        const recordedAt = getLocalFirstTimestamp(point.startDateLocal, point.startDate);
        if (!Number.isFinite(recordedAt)) return null;
        return { ...point, recordedAt };
      })
      .filter(Boolean)
  }));
  const durationValues = datedSeries.flatMap((item) => item.points.map((point) => point.durationSeconds));
  const recordedDates = datedSeries.flatMap((item) => item.points.map((point) => point.recordedAt));
  const minDuration = Math.min(...durationValues);
  const maxDuration = Math.max(...durationValues);
  const today = startOfLocalDay(new Date());
  const todayTime = today.getTime();
  if (!recordedDates.length || !Number.isFinite(minDuration) || !Number.isFinite(maxDuration) || !maxDuration || !Number.isFinite(todayTime)) {
    els.timeBestRecencyChartCaption.textContent = "No data";
    return renderEmpty(els.timeBestRecencyChart, "No time best timing data");
  }

  const pointsWithDays = datedSeries.map((item) => ({
    ...item,
    points: item.points.map((point) => ({
      ...point,
      daysAgo: Math.max(0, Math.round((todayTime - startOfLocalDay(new Date(point.recordedAt)).getTime()) / (24 * 60 * 60 * 1000)))
    }))
  }));
  const maxDaysAgo = Math.max(...pointsWithDays.flatMap((item) => item.points.map((point) => point.daysAgo)), 1);
  els.timeBestRecencyChartCaption.textContent = `As of ${formatDate(today)}`;

  const durations = appState.personalBests?.durations || [];
  const width = 980;
  const height = 318;
  const padding = { top: 24, right: 28, bottom: 58, left: 62 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const useLogScale = appState.timeBestScale === "log" && minDuration > 0 && maxDuration > minDuration;
  const xMin = useLogScale ? minDuration : 0;
  const xMax = useLogScale ? maxDuration : Math.max(maxDuration, durations.at(-1)?.durationSeconds || maxDuration);
  const logMin = useLogScale ? Math.log(xMin) : 0;
  const logSpread = useLogScale ? Math.max(Math.log(xMax) - logMin, 0.0001) : 1;
  const yMax = Math.ceil(maxDaysAgo / 90) * 90 || 90;
  const x = (durationSeconds) => {
    if (!useLogScale) return padding.left + (durationSeconds / xMax) * chartWidth;
    return padding.left + ((Math.log(durationSeconds) - logMin) / logSpread) * chartWidth;
  };
  const y = (daysAgo) => padding.top + (daysAgo / yMax) * chartHeight;
  const xTicks = getTimeBestDurationTicks({ useLogScale, minDuration, maxDuration, xMax, durations });
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((ratio) => Math.round(yMax * ratio));

  const grid = [
    ...xTicks.map((duration) => {
      const tickX = x(duration.durationSeconds);
      return `
        <line x1="${tickX}" x2="${tickX}" y1="${padding.top}" y2="${height - padding.bottom}" stroke="#e5e9e3"></line>
        <text class="axis-label" x="${tickX}" y="${height - 22}" text-anchor="middle">${escapeHtml(formatTimeBestTick(duration))}</text>
      `;
    }),
    ...yTicks.map((tick) => {
      const tickY = y(tick);
      return `
        <line x1="${padding.left}" x2="${width - padding.right}" y1="${tickY}" y2="${tickY}" stroke="#d9dfd7"></line>
        <text class="axis-label" x="8" y="${tickY + 4}">${formatDDay(tick)}</text>
      `;
    })
  ].join("");

  const lines = pointsWithDays.map((item) => {
    if (item.points.length < 2) return "";
    const path = item.points
      .map((point, index) => `${index ? "L" : "M"} ${x(point.durationSeconds).toFixed(1)} ${y(point.daysAgo).toFixed(1)}`)
      .join(" ");
    const isOldest = item.boundary === "oldest";
    const dots = item.points.map((point) => `
      <circle cx="${x(point.durationSeconds)}" cy="${y(point.daysAgo)}" r="${isOldest ? 5 : 4}" fill="${isOldest ? "var(--surface)" : item.color}" stroke="${item.color}" stroke-width="${isOldest ? 2 : 0}" data-tooltip="${escapeHtml(`${item.label} ${item.boundaryLabel} ${point.durationName}\n${formatDDay(point.daysAgo)} · #${point.rank}\n${formatDate(point.startDateLocal || point.startDate)}`)}"></circle>
    `).join("");
    return `
      <path d="${path}" fill="none" stroke="${item.color}" stroke-width="${isOldest ? 2.4 : 3}" ${isOldest ? "stroke-dasharray=\"8 6\"" : ""} stroke-linecap="round" stroke-linejoin="round"></path>
      ${dots}
    `;
  }).join("");

  const colorLegend = getPersonalBestSeriesDefinitions().map((item, index) => {
    const xPosition = padding.left + index * 96;
    return `
      <g transform="translate(${xPosition}, 10)">
        <line x1="0" x2="22" y1="0" y2="0" stroke="${item.color}" stroke-width="3"></line>
        <text class="axis-label" x="28" y="4">${item.label}</text>
      </g>
    `;
  }).join("");
  const styleLegend = `
    <g transform="translate(${padding.left + 330}, 10)">
      <line x1="0" x2="22" y1="0" y2="0" stroke="#59635b" stroke-width="3"></line>
      <text class="axis-label" x="28" y="4">Newest</text>
    </g>
    <g transform="translate(${padding.left + 446}, 10)">
      <line x1="0" x2="22" y1="0" y2="0" stroke="#59635b" stroke-width="2.4" stroke-dasharray="8 6"></line>
      <circle cx="11" cy="0" r="4" fill="var(--surface)" stroke="#59635b" stroke-width="2"></circle>
      <text class="axis-label" x="28" y="4">Oldest</text>
    </g>
  `;

  els.timeBestRecencyChart.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Top 1, top 3, and top 10 time best timing by duration">
      ${grid}
      <text class="axis-label" x="${padding.left + chartWidth / 2}" y="${height - 4}" text-anchor="middle">Time</text>
      <text class="axis-label" x="10" y="16">D-day</text>
      ${colorLegend}
      ${styleLegend}
      ${lines}
    </svg>
  `;
}

function renderTimeBestTrendChart() {
  if (!els.timeBestTrendChart) return;
  appState.timeBestTrendLimit = normalizePersonalBestTrendLimit(appState.timeBestTrendLimit);
  updateTimeBestTrendLimitButtons();
  const durations = getTimeBestTrendDurations();
  const selected = resolveTimeBestTrendDuration(durations);
  renderTimeBestTrendDurationOptions(durations, selected?.name || null);

  if (!selected) {
    els.timeBestTrendCaption.textContent = "";
    return renderEmpty(els.timeBestTrendChart, "No time best trend data");
  }

  const selectedLimit = normalizePersonalBestTrendLimit(appState.timeBestTrendLimit);
  const efforts = selected.trendEfforts;
  const activeEfforts = efforts.filter((effort) => effort.rank <= selectedLimit);
  const dates = efforts.map((effort) => effort.recordedAt);
  const minDate = Math.min(...dates);
  const maxDate = Math.max(...dates);
  const trend = buildPaceTrend(activeEfforts);
  const paceValues = efforts.map((effort) => effort.paceSecondsPerKm);
  if (trend) paceValues.push(trend.startPace, trend.endPace);
  const paceDomain = buildPaceAxisDomain(paceValues);

  const width = 980;
  const height = 318;
  const padding = { top: 48, right: 30, bottom: 42, left: 62 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const dateSpread = Math.max(maxDate - minDate, 1);
  const x = (date) => padding.left + ((date - minDate) / dateSpread) * chartWidth;
  const y = (pace) => padding.top + ((pace - paceDomain.min) / paceDomain.spread) * chartHeight;
  const trendLegendLabel = trend ? `Trend ${formatPaceTrendRate(trend.annualPaceChange)}` : "Trend";
  const contextLegendLabel = `Top ${PERSONAL_BEST_TREND_LIMIT}`;
  els.timeBestTrendCaption.textContent = "";

  const xTicks = getDateTicks(minDate, maxDate);
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((ratio) => paceDomain.min + ratio * paceDomain.spread);
  const grid = [
    ...xTicks.map((tick) => {
      const tickX = x(tick);
      return `
        <line x1="${tickX}" x2="${tickX}" y1="${padding.top}" y2="${height - padding.bottom}" stroke="#e5e9e3"></line>
        <text class="axis-label" x="${tickX}" y="${height - 18}" text-anchor="middle">${formatDate(tick)}</text>
      `;
    }),
    ...yTicks.map((tick) => {
      const tickY = y(tick);
      return `
        <line x1="${padding.left}" x2="${width - padding.right}" y1="${tickY}" y2="${tickY}" stroke="#d9dfd7"></line>
        <text class="axis-label" x="10" y="${tickY + 4}">${formatPace(tick)}</text>
      `;
    })
  ].join("");

  const contextPath = efforts
    .map((effort, index) => `${index ? "L" : "M"} ${x(effort.recordedAt).toFixed(1)} ${y(effort.paceSecondsPerKm).toFixed(1)}`)
    .join(" ");
  const activePath = activeEfforts.length > 1 ? activeEfforts
    .map((effort, index) => `${index ? "L" : "M"} ${x(effort.recordedAt).toFixed(1)} ${y(effort.paceSecondsPerKm).toFixed(1)}`)
    .join(" ") : "";
  const dots = efforts.map((effort) => `
    <circle cx="${x(effort.recordedAt)}" cy="${y(effort.paceSecondsPerKm)}" r="${effort.rank <= selectedLimit ? "4" : "3.4"}" fill="#24724f" stroke="#ffffff" stroke-width="1.5" opacity="${effort.rank <= selectedLimit ? "1" : "0.24"}" data-tooltip="${escapeHtml(`${selected.name} #${effort.rank}${effort.rank <= selectedLimit ? "" : ` · outside top ${selectedLimit}`}\n${formatDate(effort.startDateLocal || effort.startDate)} · ${formatPaceWithUnit(effort.paceSecondsPerKm)}\n${formatNumber(effort.distanceKm, 2)} km · ${effort.activityName || "Untitled"}`)}"></circle>
  `).join("");
  const trendPath = trend ? `
    <path d="M ${x(activeEfforts[0].recordedAt).toFixed(1)} ${y(trend.startPace).toFixed(1)} L ${x(activeEfforts.at(-1).recordedAt).toFixed(1)} ${y(trend.endPace).toFixed(1)}" fill="none" stroke="#c7672f" stroke-width="2.6" stroke-dasharray="8 6" stroke-linecap="round"></path>
  ` : "";
  const legend = `
    <g transform="translate(${padding.left}, 22)">
      <line x1="0" x2="22" y1="0" y2="0" stroke="#24724f" stroke-width="3"></line>
      <text class="axis-label" x="28" y="4">Selected Bests</text>
    </g>
    <g transform="translate(${padding.left + 170}, 22)">
      <line x1="0" x2="22" y1="0" y2="0" stroke="#24724f" stroke-width="3" opacity="0.22"></line>
      <text class="axis-label" x="28" y="4">${escapeHtml(contextLegendLabel)}</text>
    </g>
    <g transform="translate(${padding.left + 278}, 22)">
      <line x1="0" x2="22" y1="0" y2="0" stroke="#c7672f" stroke-width="2.6" stroke-dasharray="8 6"></line>
      <text class="axis-label" x="28" y="4">${escapeHtml(trendLegendLabel)}</text>
    </g>
  `;

  els.timeBestTrendChart.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(`${selected.name} time best pace trend by date, ${trendLegendLabel}`)}">
      ${grid}
      ${legend}
      <path d="${contextPath}" fill="none" stroke="#24724f" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" opacity="0.18"></path>
      ${activePath ? `<path d="${activePath}" fill="none" stroke="#24724f" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"></path>` : ""}
      ${trendPath}
      ${dots}
    </svg>
  `;
}

function renderRefreshIcon() {
  return `
    <svg class="refresh-icon" aria-hidden="true" viewBox="0 0 24 24" focusable="false">
      <path d="M20 11a8 8 0 0 0-14.2-5"></path>
      <path d="M5 3v5h5"></path>
      <path d="M4 13a8 8 0 0 0 14.2 5"></path>
      <path d="M19 21v-5h-5"></path>
    </svg>
  `;
}

function renderRecordExclusionButton(effort, activityName = "record") {
  const recordKey = String(effort?.recordKey || "").trim();
  if (!recordKey) return "";

  const excluded = Boolean(effort.excluded);
  const nextExcluded = excluded ? "false" : "true";
  const label = excluded ? "Include" : "Exclude";
  const busy = appState.excludingRecordKey === recordKey;
  const buttonLabel = busy ? "Saving" : label;
  const ariaLabel = `${label} ${activityName || "record"}`;
  return `<button class="button ghost record-exclusion-button${excluded ? " is-excluded" : ""}${busy ? " is-busy" : ""}" type="button" data-record-exclusion-key="${escapeHtml(recordKey)}" data-record-exclusion-excluded="${nextExcluded}" aria-label="${escapeHtml(ariaLabel)}" title="${escapeHtml(`${label} Record`)}"${busy ? " disabled" : ""}>${buttonLabel}</button>`;
}

async function handlePersonalBestToggle(event) {
  if (!(event.target instanceof Element)) return;
  const exclusionButton = event.target.closest("[data-record-exclusion-key]");
  const inExclusionDistanceGrid = exclusionButton && els.personalBestGrid.contains(exclusionButton);
  const inExclusionDurationGrid = exclusionButton && els.personalBestDurationGrid?.contains(exclusionButton);
  if (exclusionButton && (inExclusionDistanceGrid || inExclusionDurationGrid)) {
    await updateRecordExclusion(
      exclusionButton.dataset.recordExclusionKey,
      exclusionButton.dataset.recordExclusionExcluded === "true"
    );
    return;
  }

  const refreshButton = event.target.closest("[data-refresh-activity-id]");
  const inDistanceGrid = refreshButton && els.personalBestGrid.contains(refreshButton);
  const inDurationGrid = refreshButton && els.personalBestDurationGrid?.contains(refreshButton);
  if (refreshButton && (inDistanceGrid || inDurationGrid)) {
    refreshActivityDetail(refreshButton.dataset.refreshActivityId);
    return;
  }

  const button = event.target.closest("[data-personal-best-toggle]");
  if (button && els.personalBestGrid.contains(button)) {
    const distanceName = button.dataset.personalBestToggle;
    if (!distanceName) return;

    if (appState.expandedPersonalBestDistances.has(distanceName)) {
      appState.expandedPersonalBestDistances.delete(distanceName);
    } else {
      appState.expandedPersonalBestDistances.add(distanceName);
    }
    renderPersonalBests();
    return;
  }

  const timeButton = event.target.closest("[data-time-best-toggle]");
  if (!timeButton || !els.personalBestDurationGrid?.contains(timeButton)) return;

  const durationName = timeButton.dataset.timeBestToggle;
  if (!durationName) return;

  if (appState.expandedTimeBestDurations.has(durationName)) {
    appState.expandedTimeBestDurations.delete(durationName);
  } else {
    appState.expandedTimeBestDurations.add(durationName);
  }
  renderTimeBestsView();
}

function renderRiegelAnalysis() {
  const analysis = buildRiegelAnalysis();
  if (!analysis) {
    updateRiegelExponentControls();
    els.riegelSummaryGrid.innerHTML = `<article class="kpi-card"><span>Riegel</span><strong>-</strong><small>No best effort data</small></article>`;
    els.riegelFiveKChartCaption.textContent = "";
    if (els.riegelExpectedPaceChartCaption) els.riegelExpectedPaceChartCaption.textContent = "";
    if (els.riegelExpectedPaceChart) renderEmpty(els.riegelExpectedPaceChart, "No expected pace data");
    els.riegelEquivalentChartTitle.textContent = "Baseline Prediction";
    if (els.riegelProjectionTitle) els.riegelProjectionTitle.textContent = "Riegel Projection";
    renderEmpty(els.riegelFiveKChart, "No baseline prediction data");
    els.riegelProjectionTable.innerHTML = `<tr><td colspan="5">No best effort data available for analysis</td></tr>`;
    return;
  }

  updateRiegelExponentControls(analysis.riegelExponent);
  appState.activeRiegelSourceDistanceName = analysis.source.name;
  els.riegelEquivalentChartTitle.textContent = `${analysis.source.name} Prediction`;
  if (els.riegelProjectionTitle) els.riegelProjectionTitle.textContent = `Riegel Projection · ${analysis.source.name}`;
  const expectedTargetCards = (analysis.expectedTargetRecords || []).map((target) => {
    const predictedTime = Number.isFinite(target.predictedTime) ? formatClockDuration(target.predictedTime) : "-";
    const predictedPace = Number.isFinite(target.predictedPaceSecondsPerKm)
      ? formatPaceWithUnit(target.predictedPaceSecondsPerKm)
      : "-";
    const comparison = Number.isFinite(target.deltaSeconds) ? ` · ${formatDelta(target.deltaSeconds)}` : "";
    return `
      <article class="kpi-card">
        <span>Expected ${escapeHtml(target.name)}</span>
        <strong>${predictedTime}</strong>
        <small>${predictedPace}${comparison}</small>
      </article>
    `;
  }).join("");

  els.riegelSummaryGrid.innerHTML = `
    ${expectedTargetCards}
    <article class="kpi-card kpi-card--value-only">
      <span>Median Exponent</span>
      <strong>${Number.isFinite(analysis.medianExponent) ? formatNumber(analysis.medianExponent, 3) : "-"}</strong>
    </article>
  `;

  renderRiegelEquivalentChart(analysis.equivalentRows, analysis.source);
  renderRiegelExpectedPaceChart(analysis.expectedPaceSeries);

  els.riegelProjectionTable.innerHTML = analysis.projectionRows.map((row) => `
    <tr>
      <td>${escapeHtml(row.name)}</td>
      <td>${row.actualTime ? formatClockDuration(row.actualTime) : "-"}</td>
      <td>${formatClockDuration(row.predictedTime)}</td>
      <td>${formatDelta(row.deltaSeconds)}</td>
      <td>${formatPaceWithUnit(row.predictedPaceSecondsPerKm)}</td>
    </tr>
  `).join("");
}

function buildRiegelAnalysis() {
  const selectedSeries = getSelectedRiegelSeries();
  const pbByName = getPersonalBestByName(selectedSeries.index);

  const ordered = getRiegelExponentSources(selectedSeries.index);
  const exponentRowsBase = [];
  for (let index = 0; index < ordered.length - 1; index += 1) {
    const from = ordered[index];
    const to = ordered[index + 1];
    if (to.distanceKm <= from.distanceKm) continue;
    exponentRowsBase.push({
      fromName: from.name,
      toName: to.name,
      fromKm: from.distanceKm,
      toKm: to.distanceKm,
      fromTime: from.time,
      toTime: to.time,
      exponent: Math.log(to.time / from.time) / Math.log(to.distanceKm / from.distanceKm)
    });
  }

  const medianRows = exponentRowsBase;
  const medianExponent = median(medianRows.map((row) => row.exponent));
  const riegelExponent = getRiegelExponent(medianExponent);
  appState.riegelExponent = riegelExponent;
  const sourceOptions = getRiegelSourceDistanceOptions(selectedSeries.index, riegelExponent);
  const source = resolveRiegelSourceDistance(sourceOptions);
  if (!source) return null;

  const projectionRows = getRiegelProjectionTargets()
    .map((target) => {
      const predictedTime = predictRiegelTime(source.time, source.distanceKm, target.distanceKm, riegelExponent);
      const actual = pbByName.get(target.name);
      return {
        ...target,
        actualTime: actual?.time || null,
        predictedTime,
        predictedPaceSecondsPerKm: predictedTime / target.distanceKm,
        deltaSeconds: actual ? actual.time - predictedTime : null
      };
    });
  const expectedPaceSeries = getPersonalBestSeriesDefinitions().map((series) => ({
    ...series,
    points: getRiegelExpectedPaceRows(series, riegelExponent)
  }));
  const expectedTargetRecords = getExpectedTargetRecords(expectedPaceSeries, selectedSeries);
  const sourceTop = getPersonalBestEffortsByName(source.name);
  const distanceByName = new Map((appState.personalBests?.distances || [])
    .filter((distance) => distance.name)
    .map((distance) => [distance.name, distance]));
  const equivalentTargets = getRiegelProjectionTargets();
  const equivalentRows = getPersonalBestSeriesDefinitions().map((series) => ({
    ...series,
    points: equivalentTargets
      .map((target) => {
        const distance = distanceByName.get(target.name);
        const effort = distance?.top?.[series.index];
        const distanceKm = Number(distance?.distanceKm || target.distanceKm || 0);
        if (!distanceKm) return null;
        if (!effort) {
          return {
            name: target.name,
            distanceKm,
            isPlaceholder: true
          };
        }
        const sourceEffort = sourceTop[series.index] || sourceTop[0] || null;
        const sourceTime = sourceEffort ? Number(sourceEffort.movingTime || 0) : source.time;
        const movingTime = Number(effort.movingTime || 0);
        if (!movingTime) return null;
        const predictedTime = predictRiegelTime(movingTime, distanceKm, source.distanceKm, riegelExponent);
        return {
          name: distance.name,
          distanceKm,
          sourceTime: movingTime,
          predictedTime,
          deltaSeconds: predictedTime - sourceTime,
          paceSecondsPerKm: predictedTime / source.distanceKm
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.distanceKm - b.distanceKm)
  }));

  return {
    source,
    sourceOptions,
    selectedSeries,
    riegelExponent,
    projectionRows,
    expectedPaceSeries,
    expectedTargetRecords,
    equivalentRows,
    medianExponent
  };
}

function getRiegelExpectedPaceRows(selectedSeries, riegelExponent) {
  const currentByName = getPersonalBestByName(selectedSeries.index);
  const sources = getRiegelExponentSources(selectedSeries.index)
    .filter((source) => (
      Number.isFinite(source.distanceKm) &&
      source.distanceKm > 0 &&
      Number.isFinite(source.time) &&
      source.time > 0
    ));
  if (!sources.length || !isValidRiegelExponent(riegelExponent)) return [];

  return getRiegelProjectionTargets()
    .map((target) => {
      const distanceKm = Number(target.distanceKm || 0);
      if (!target.name || !Number.isFinite(distanceKm) || distanceKm <= 0) return null;
      const predictedTimes = sources
        .map((source) => predictRiegelTime(source.time, source.distanceKm, distanceKm, riegelExponent))
        .filter((value) => Number.isFinite(value) && value > 0);
      const predictedTime = median(predictedTimes);
      if (!Number.isFinite(predictedTime) || predictedTime <= 0) return null;
      const actual = currentByName.get(target.name);
      return {
        name: target.name,
        distanceKm,
        predictedTime,
        predictedPaceSecondsPerKm: predictedTime / distanceKm,
        actualTime: actual?.time || null,
        deltaSeconds: actual ? predictedTime - actual.time : null,
        sourceCount: predictedTimes.length
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.distanceKm - b.distanceKm || a.name.localeCompare(b.name));
}

function getExpectedTargetRecords(expectedPaceSeries, selectedSeries) {
  const series = expectedPaceSeries.find((item) => item.key === selectedSeries.key) || expectedPaceSeries[0];
  const targets = new Map(getRiegelProjectionTargets().map((target) => [target.name, target]));
  return EXPECTED_SUMMARY_TARGET_NAMES.map((name) => {
    const row = series?.points?.find((point) => point.name === name);
    const target = targets.get(name);
    return {
      name,
      distanceKm: Number(row?.distanceKm || target?.distanceKm || 0),
      predictedTime: Number(row?.predictedTime || 0),
      predictedPaceSecondsPerKm: Number(row?.predictedPaceSecondsPerKm || 0),
      actualTime: Number(row?.actualTime || 0),
      deltaSeconds: Number.isFinite(row?.deltaSeconds) ? row.deltaSeconds : null,
      sourceCount: Number(row?.sourceCount || 0)
    };
  });
}

function getRiegelProjectionTargets() {
  const targetsByName = new Map();
  for (const distance of appState.personalBests?.distances || []) {
    const distanceKm = Number(distance.distanceKm || 0);
    if (!distance.name || !Number.isFinite(distanceKm) || distanceKm <= 0) continue;
    targetsByName.set(distance.name, {
      name: distance.name,
      distanceKm
    });
  }

  for (const target of RIEGEL_TARGETS) {
    if (!targetsByName.has(target.name)) targetsByName.set(target.name, target);
  }

  return Array.from(targetsByName.values())
    .sort((a, b) => a.distanceKm - b.distanceKm || a.name.localeCompare(b.name));
}

function renderRiegelEquivalentChart(seriesRows, source) {
  for (const button of els.riegelFiveKScaleButtons) {
    button.classList.toggle("active", button.dataset.scale === appState.riegelFiveKScale);
  }
  for (const button of els.riegelFiveKSeriesButtons) {
    button.classList.toggle("active", button.dataset.series === appState.riegelFiveKSeries);
  }

  const series = (seriesRows || []).map((item) => ({
    ...item,
    points: (item.points || []).filter((point) => (
      Number.isFinite(point.distanceKm) &&
      (point.isPlaceholder || Number.isFinite(point.predictedTime))
    ))
  }));
  const allActualPoints = series.flatMap((item) => item.points.filter((point) => !point.isPlaceholder));
  if (!allActualPoints.length) {
    els.riegelFiveKChartCaption.textContent = "";
    return renderEmpty(els.riegelFiveKChart, `No ${source.name} prediction data`);
  }
  const selectedSeries = series.find((item) => item.key === appState.riegelFiveKSeries) || series[0];
  appState.riegelFiveKSeries = selectedSeries.key;
  for (const button of els.riegelFiveKSeriesButtons) {
    button.classList.toggle("active", button.dataset.series === selectedSeries.key);
  }
  const selectedActualPoints = selectedSeries.points.filter((point) => !point.isPlaceholder);
  if (!selectedActualPoints.length) {
    els.riegelFiveKChartCaption.textContent = "";
    return renderEmpty(els.riegelFiveKChart, `No ${selectedSeries.label} ${source.name} prediction data`);
  }
  const expectedTime = median(selectedActualPoints.map((point) => point.predictedTime));
  const expectedPace = Number.isFinite(expectedTime) && source.distanceKm > 0 ? expectedTime / source.distanceKm : null;
  const displayPoints = selectedSeries.points
    .map((point) => point.isPlaceholder
      ? {
        ...point,
        predictedTime: expectedTime,
        paceSecondsPerKm: expectedPace,
        deltaSeconds: null
      }
      : point)
    .filter((point) => Number.isFinite(point.predictedTime) && Number.isFinite(point.paceSecondsPerKm));

  const paceDomainPoints = displayPoints;
  const width = 980;
  const height = 318;
  const padding = { top: 24, right: 28, bottom: 48, left: 62 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const minDistance = Math.min(...displayPoints.map((point) => point.distanceKm));
  const maxDistance = Math.max(...displayPoints.map((point) => point.distanceKm));
  const useLogScale = appState.riegelFiveKScale === "log" && minDistance > 0 && maxDistance > minDistance;
  els.riegelFiveKChartCaption.textContent = "";

  const xMin = useLogScale ? minDistance : 0;
  const xMax = useLogScale ? maxDistance : Math.ceil(maxDistance / 5) * 5;
  const logMin = useLogScale ? Math.log(xMin) : 0;
  const logSpread = useLogScale ? Math.max(Math.log(xMax) - logMin, 0.0001) : 1;
  const paceDomainValues = paceDomainPoints.map((point) => point.paceSecondsPerKm);
  if (Number.isFinite(expectedPace)) paceDomainValues.push(expectedPace);
  const paceDomain = buildPaceAxisDomain(paceDomainValues);
  const x = (distanceKm) => {
    if (!useLogScale) return padding.left + (distanceKm / xMax) * chartWidth;
    return padding.left + ((Math.log(distanceKm) - logMin) / logSpread) * chartWidth;
  };
  const y = (pace) => padding.top + ((pace - paceDomain.min) / paceDomain.spread) * chartHeight;
  const clampY = (pace) => Math.max(padding.top, Math.min(height - padding.bottom - 2, y(pace)));
  const xTicks = getDistanceTicks({ useLogScale, minDistance, maxDistance, xMax });
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((ratio) => paceDomain.min + ratio * paceDomain.spread);

  const grid = [
    ...xTicks.map((tick) => {
      const tickX = x(tick);
      return `
        <line x1="${tickX}" x2="${tickX}" y1="${padding.top}" y2="${height - padding.bottom}" stroke="#e5e9e3"></line>
        <text class="axis-label" x="${tickX}" y="${height - 18}" text-anchor="middle">${formatDistanceTick(tick)}</text>
      `;
    }),
    ...yTicks.map((tick) => {
      const tickY = y(tick);
      return `
        <line x1="${padding.left}" x2="${width - padding.right}" y1="${tickY}" y2="${tickY}" stroke="#d9dfd7"></line>
        <text class="axis-label" x="10" y="${tickY + 4}">${formatPace(tick)}</text>
      `;
    })
  ].join("");

  const xPositions = displayPoints.map((point) => x(point.distanceKm));
  const baselineY = height - padding.bottom;
  const barWidth = useLogScale ? 24 : 34;
  const bars = displayPoints.map((point, index) => {
    const centerX = xPositions[index];
    const barX = Math.max(padding.left, Math.min(centerX - barWidth / 2, width - padding.right - barWidth));
    const barY = clampY(point.paceSecondsPerKm);
    const barHeight = Math.max(2, baselineY - barY);
    const isPlaceholder = Boolean(point.isPlaceholder);
    const isSource = point.name === source.name;
    const fill = isSource ? RIEGEL_REFERENCE_COLOR : selectedSeries.color;
    if (isPlaceholder) {
      const actionText = isSource ? "Current predicted baseline distance" : `Click to use predicted ${point.name} as baseline`;
      const fillColor = isSource ? RIEGEL_REFERENCE_COLOR : "#d5ded6";
      const strokeColor = isSource ? "#ffffff" : "#7c8a80";
      const opacity = isSource ? "1" : "0.72";
      const tooltip = `No ${selectedSeries.label} ${point.name} best effort yet\nPredicted ${source.name} ${formatClockDuration(point.predictedTime)}\n${formatPaceWithUnit(point.paceSecondsPerKm)}\n${actionText}`;
      return `
        <rect class="riegel-source-bar placeholder${isSource ? " active" : ""}" x="${barX.toFixed(1)}" y="${barY.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${barHeight.toFixed(1)}" rx="2" fill="${fillColor}" stroke="${strokeColor}" stroke-width="2" stroke-dasharray="5 4" opacity="${opacity}" tabindex="0" role="button" aria-label="${escapeHtml(`Use predicted ${point.name} as baseline`)}" data-riegel-source-name="${escapeHtml(point.name)}" data-riegel-placeholder="true" data-tooltip="${escapeHtml(tooltip)}"></rect>
      `;
    }
    const actionText = isSource ? "Current baseline distance" : `Click to use ${point.name} as baseline`;
    return `
      <rect class="riegel-source-bar${isSource ? " active" : ""}" x="${barX.toFixed(1)}" y="${barY.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${barHeight.toFixed(1)}" rx="2" fill="${fill}" stroke="#ffffff" stroke-width="2" tabindex="0" role="button" aria-label="${escapeHtml(`Use ${point.name} as baseline`)}" data-riegel-source-name="${escapeHtml(point.name)}" data-tooltip="${escapeHtml(`${selectedSeries.label} ${point.name}\n${source.name} prediction ${formatClockDuration(point.predictedTime)}\n${formatPaceWithUnit(point.paceSecondsPerKm)} · vs baseline ${source.name} ${formatDeltaPlain(point.deltaSeconds)}\n${actionText}`)}"></rect>
    `;
  }).join("");
  const expectedRecordLine = Number.isFinite(expectedPace) ? (() => {
    const expectedY = clampY(expectedPace);
    const labelY = expectedY < padding.top + 20 ? expectedY + 18 : expectedY - 8;
    const label = `Expected ${source.name} ${formatClockDuration(expectedTime)}`;
    const tooltip = `${label}\nMedian of ${selectedSeries.label} ${source.name} predictions\n${formatPaceWithUnit(expectedPace)}`;
    const expectedRecordColor = "#7f4aa4";
    return `
      <line x1="${padding.left}" x2="${width - padding.right}" y1="${expectedY.toFixed(1)}" y2="${expectedY.toFixed(1)}" stroke="${expectedRecordColor}" stroke-width="2.8" stroke-dasharray="9 7" stroke-linecap="round" data-tooltip="${escapeHtml(tooltip)}"></line>
      <text class="axis-label" x="${width - padding.right - 6}" y="${labelY.toFixed(1)}" text-anchor="end" style="fill:${expectedRecordColor}" data-tooltip="${escapeHtml(tooltip)}">${escapeHtml(label)}</text>
    `;
  })() : "";

  els.riegelFiveKChart.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(`${selectedSeries.label} Riegel ${source.name} prediction chart by predictor distance`)}">
      ${grid}
      ${bars}
      ${expectedRecordLine}
      <text class="axis-label" x="${padding.left + chartWidth / 2}" y="${height - 4}" text-anchor="middle">Predictor Distance (km)</text>
      <text class="axis-label" x="10" y="16">Pace</text>
    </svg>
  `;
}

function renderRiegelExpectedPaceChart(expectedSeries) {
  if (!els.riegelExpectedPaceChart || !els.riegelExpectedPaceChartCaption) return;

  const series = (expectedSeries || [])
    .map((item) => {
      const mappedPoints = (item.points || [])
        .map((row) => {
          const distanceKm = Number(row.distanceKm || 0);
          const actualTime = Number(row.actualTime || 0);
          const hasCurrent = (
            Number.isFinite(actualTime) &&
            actualTime > 0 &&
            Number.isFinite(distanceKm) &&
            distanceKm > 0
          );
          const deltaSeconds = Number.isFinite(row.deltaSeconds) ? row.deltaSeconds : null;
          return {
            name: row.name,
            distanceKm,
            predictedTime: Number(row.predictedTime || 0),
            paceSecondsPerKm: Number(row.predictedPaceSecondsPerKm || 0),
            actualTime: hasCurrent ? actualTime : null,
            actualPaceSecondsPerKm: hasCurrent ? actualTime / distanceKm : null,
            deltaSeconds,
            gapSeconds: hasCurrent && Number.isFinite(deltaSeconds) ? -deltaSeconds : null,
            paceGapSecondsPerKm: hasCurrent && Number.isFinite(deltaSeconds)
              ? -deltaSeconds / distanceKm
              : null,
            hasCurrent,
            sourceCount: Number(row.sourceCount || 0)
          };
        });
      const maxCurrentDistanceKm = Math.max(
        0,
        ...mappedPoints
          .filter((point) => point.hasCurrent)
          .map((point) => point.distanceKm)
      );
      const points = mappedPoints
        .filter((point) => {
          const hasExpectedPace = (
            point.name &&
            Number.isFinite(point.distanceKm) &&
            point.distanceKm > 0 &&
            Number.isFinite(point.predictedTime) &&
            point.predictedTime > 0 &&
            Number.isFinite(point.paceSecondsPerKm) &&
            point.paceSecondsPerKm > 0
          );
          if (!hasExpectedPace) return false;
          const extendsCurrentRange = (
            point.distanceKm > maxCurrentDistanceKm &&
            point.distanceKm <= RIEGEL_EXPECTED_PACE_CHART_MAX_PROJECTED_DISTANCE_KM
          );
          return point.hasCurrent || extendsCurrentRange;
        })
        .sort((a, b) => a.distanceKm - b.distanceKm || a.name.localeCompare(b.name));
      return {
        ...item,
        points
      };
    })
    .filter((item) => item.points.length);

  if (!series.length) {
    els.riegelExpectedPaceChartCaption.textContent = "";
    return renderEmpty(els.riegelExpectedPaceChart, "No expected pace data");
  }

  const selectedSeries = series.find((item) => item.key === appState.riegelFiveKSeries) || series[0];
  appState.riegelFiveKSeries = selectedSeries.key;
  for (const button of els.riegelFiveKSeriesButtons) {
    button.classList.toggle("active", button.dataset.series === selectedSeries.key);
  }
  const points = selectedSeries.points;
  for (const button of els.riegelFiveKScaleButtons) {
    button.classList.toggle("active", button.dataset.scale === appState.riegelFiveKScale);
  }

  if (!points.length) {
    els.riegelExpectedPaceChartCaption.textContent = "";
    return renderEmpty(els.riegelExpectedPaceChart, `No ${selectedSeries.label} expected pace data`);
  }

  els.riegelExpectedPaceChartCaption.textContent = "";
  const currentPoints = points.filter((point) => (
    point.hasCurrent &&
    Number.isFinite(point.actualPaceSecondsPerKm) &&
    point.actualPaceSecondsPerKm > 0
  ));
  const comparisonPoints = points.filter((point) => (
    point.hasCurrent &&
    Number.isFinite(point.gapSeconds) &&
    Number.isFinite(point.paceGapSecondsPerKm)
  ));

  const width = 980;
  const height = 480;
  const padding = { top: 34, right: 32, bottom: 78, left: 92 };
  const chartWidth = width - padding.left - padding.right;
  const pacePanel = { top: 84, bottom: 226 };
  pacePanel.height = pacePanel.bottom - pacePanel.top;
  const gapPanel = { top: 290, bottom: 386 };
  gapPanel.height = gapPanel.bottom - gapPanel.top;
  const minDistance = Math.min(...points.map((point) => point.distanceKm));
  const maxDistance = Math.max(...points.map((point) => point.distanceKm));
  const useLogScale = appState.riegelFiveKScale === "log" && minDistance > 0 && maxDistance > minDistance;
  const xMax = useLogScale ? maxDistance : Math.ceil(maxDistance / 5) * 5;
  const xMin = useLogScale ? minDistance : 0;
  const logMin = useLogScale ? Math.log(xMin) : 0;
  const logSpread = useLogScale ? Math.max(Math.log(xMax) - logMin, 0.0001) : 1;
  const paceDomain = buildPaceAxisDomain(points.flatMap((point) => (
    point.hasCurrent
      ? [point.paceSecondsPerKm, point.actualPaceSecondsPerKm]
      : [point.paceSecondsPerKm]
  )));
  const maxGap = 10;
  const gapSpread = maxGap * 2;
  const showGapLabels = comparisonPoints.length <= 6;

  const x = (distanceKm) => {
    if (!useLogScale) return padding.left + (distanceKm / xMax) * chartWidth;
    return padding.left + ((Math.log(distanceKm) - logMin) / logSpread) * chartWidth;
  };
  const yPace = (pace) => pacePanel.top + ((pace - paceDomain.min) / paceDomain.spread) * pacePanel.height;
  const clampGap = (paceGap) => Math.max(-maxGap, Math.min(maxGap, paceGap));
  const yGap = (paceGap) => gapPanel.top + ((maxGap + clampGap(paceGap)) / gapSpread) * gapPanel.height;
  const xTicks = getDistanceTicks({ useLogScale, minDistance, maxDistance, xMax });
  const paceYTicks = [0, 0.25, 0.5, 0.75, 1].map((ratio) => paceDomain.min + ratio * paceDomain.spread);
  const gapYTicks = [-maxGap, -maxGap / 2, 0, maxGap / 2, maxGap];

  const grid = [
    ...xTicks.map((tick) => {
      const tickX = x(tick);
      return `
        <line x1="${tickX.toFixed(1)}" x2="${tickX.toFixed(1)}" y1="${pacePanel.top}" y2="${pacePanel.bottom}" stroke="#e5e9e3"></line>
        <line x1="${tickX.toFixed(1)}" x2="${tickX.toFixed(1)}" y1="${gapPanel.top}" y2="${gapPanel.bottom}" stroke="#e5e9e3"></line>
      `;
    }),
    ...paceYTicks.map((tick) => {
      const tickY = yPace(tick);
      return `
        <line x1="${padding.left}" x2="${width - padding.right}" y1="${tickY.toFixed(1)}" y2="${tickY.toFixed(1)}" stroke="#d9dfd7"></line>
        <text class="axis-label" x="10" y="${tickY + 4}">${formatPace(tick)}</text>
      `;
    }),
    ...gapYTicks.map((tick) => {
      const tickY = yGap(tick);
      const isZero = Math.abs(tick) < 0.0001;
      return `
        <line x1="${padding.left}" x2="${width - padding.right}" y1="${tickY.toFixed(1)}" y2="${tickY.toFixed(1)}" stroke="${isZero ? "#17201a" : "#d9dfd7"}" stroke-width="${isZero ? "1.6" : "1"}"></line>
        <text class="axis-label" x="10" y="${tickY + 4}">${formatPaceGapTick(tick)}</text>
      `;
    })
  ].join("");

  const legend = `
    <g data-riegel-legend="expected" transform="translate(${padding.left}, 52)">
      <line x1="0" x2="22" y1="0" y2="0" stroke="${selectedSeries.color}" stroke-width="3"></line>
      <text class="axis-label" x="28" y="4">Expected ${selectedSeries.label}</text>
    </g>
    <g data-riegel-legend="current" transform="translate(${padding.left + 162}, 52)">
      <line x1="0" x2="22" y1="0" y2="0" stroke="#17201a" stroke-width="3"></line>
      <text class="axis-label" x="28" y="4">Current ${selectedSeries.label}</text>
    </g>
  `;
  const minDistanceLabelGap = points.length > 10 ? 132 : 112;
  const visibleDistanceLabelPoints = [];
  let lastDistanceLabelX = -Infinity;
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    const labelX = x(point.distanceKm);
    const isLast = index === points.length - 1;
    if (points.length <= 8 || index === 0 || labelX - lastDistanceLabelX >= minDistanceLabelGap) {
      visibleDistanceLabelPoints.push(point);
      lastDistanceLabelX = labelX;
      continue;
    }
    if (isLast) {
      const previous = visibleDistanceLabelPoints[visibleDistanceLabelPoints.length - 1];
      if (previous && labelX - x(previous.distanceKm) < minDistanceLabelGap && visibleDistanceLabelPoints.length > 1) {
        visibleDistanceLabelPoints.pop();
      }
      visibleDistanceLabelPoints.push(point);
    }
  }
  const distanceLabels = visibleDistanceLabelPoints.map((point) => {
    const labelX = x(point.distanceKm);
    const labelY = height - 42;
    return `
      <text class="axis-label" data-riegel-distance-label="${escapeHtml(point.name)}" x="${labelX.toFixed(1)}" y="${labelY}" text-anchor="end" transform="rotate(-34 ${labelX.toFixed(1)} ${labelY})">${escapeHtml(formatHeatmapDistanceLabel(point.name))}</text>
    `;
  }).join("");

  const expectedPath = points
    .map((point, index) => `${index ? "L" : "M"} ${x(point.distanceKm).toFixed(1)} ${yPace(point.paceSecondsPerKm).toFixed(1)}`)
    .join(" ");
  const currentPath = currentPoints
    .map((point, index) => `${index ? "L" : "M"} ${x(point.distanceKm).toFixed(1)} ${yPace(point.actualPaceSecondsPerKm).toFixed(1)}`)
    .join(" ");
  const pointXPositions = points.map((point) => x(point.distanceKm)).sort((a, b) => a - b);
  const minPointGap = pointXPositions.length > 1
    ? Math.min(...pointXPositions.slice(1).map((position, index) => position - pointXPositions[index]))
    : 34;
  const gapBarWidth = Math.max(7, Math.min(24, minPointGap * 0.46));
  const zeroGapY = yGap(0);
  const paceConnectors = comparisonPoints.map((point) => {
    const pointX = x(point.distanceKm);
    const expectedY = yPace(point.paceSecondsPerKm);
    const currentY = yPace(point.actualPaceSecondsPerKm);
    const gapLabel = formatPaceGapLabel(point.paceGapSecondsPerKm);
    const gapColor = point.paceGapSecondsPerKm < 0 ? "#24724f" : point.paceGapSecondsPerKm > 0 ? "#b24b3f" : "#6f786f";
    const tooltip = `Gap ${selectedSeries.label} ${point.name}\n${gapLabel}\nExpected ${formatPaceWithUnit(point.paceSecondsPerKm)}\nCurrent ${formatPaceWithUnit(point.actualPaceSecondsPerKm)}\n${formatExpectedVsCurrentLabel(point.deltaSeconds, selectedSeries.label)}`;
    return `
      <line x1="${pointX.toFixed(1)}" x2="${pointX.toFixed(1)}" y1="${expectedY.toFixed(1)}" y2="${currentY.toFixed(1)}" stroke="${gapColor}" stroke-width="1.8" stroke-dasharray="4 4" opacity="0.48" data-tooltip="${escapeHtml(tooltip)}"></line>
    `;
  }).join("");
  const gapBars = comparisonPoints.map((point) => {
    const pointX = x(point.distanceKm);
    const gapY = yGap(point.paceGapSecondsPerKm);
    const gapLabel = formatPaceGapLabel(point.paceGapSecondsPerKm);
    const gapColor = point.paceGapSecondsPerKm < 0 ? "#24724f" : point.paceGapSecondsPerKm > 0 ? "#b24b3f" : "#6f786f";
    const tooltip = `Gap ${selectedSeries.label} ${point.name}\n${gapLabel}\nExpected ${formatPaceWithUnit(point.paceSecondsPerKm)}\nCurrent ${formatPaceWithUnit(point.actualPaceSecondsPerKm)}\n${formatExpectedVsCurrentLabel(point.deltaSeconds, selectedSeries.label)}`;
    const rawBarHeight = Math.abs(zeroGapY - gapY);
    const barHeight = Math.max(2, rawBarHeight);
    const barY = rawBarHeight < 2 ? zeroGapY - 1 : Math.min(gapY, zeroGapY);
    const label = showGapLabels
      ? `<text class="axis-label" x="${pointX.toFixed(1)}" y="${(gapY + (point.paceGapSecondsPerKm >= 0 ? 16 : -8)).toFixed(1)}" text-anchor="middle" style="font-size:11px;fill:${gapColor}" data-riegel-gap-label="${escapeHtml(point.name)}">${gapLabel}</text>`
      : "";
    return `
      <rect x="${(pointX - gapBarWidth / 2).toFixed(1)}" y="${barY.toFixed(1)}" width="${gapBarWidth.toFixed(1)}" height="${barHeight.toFixed(1)}" rx="2" fill="${gapColor}" opacity="0.82" stroke="#ffffff" stroke-width="1.4" data-riegel-gap-bar-distance="${escapeHtml(point.name)}" data-riegel-pace-gap-seconds="${Math.round(point.paceGapSecondsPerKm)}" data-tooltip="${escapeHtml(tooltip)}"></rect>
      ${label}
    `;
  }).join("");
  const expectedDots = points.map((point) => {
    const predictionCount = point.sourceCount
      ? `${formatInteger(point.sourceCount)} ${point.sourceCount === 1 ? "prediction" : "predictions"}`
      : "available predictions";
    const currentComparison = formatExpectedVsCurrentLabel(point.deltaSeconds, selectedSeries.label);
    const tooltip = `Expected ${selectedSeries.label} ${point.name}\n${formatClockDuration(point.predictedTime)}\n${formatPaceWithUnit(point.paceSecondsPerKm)}\n${currentComparison}\nMedian of ${predictionCount}`;
    return `
      <circle cx="${x(point.distanceKm).toFixed(1)}" cy="${yPace(point.paceSecondsPerKm).toFixed(1)}" r="4.6" fill="${selectedSeries.color}" stroke="#ffffff" stroke-width="1.8" data-riegel-expected-pace-series="${escapeHtml(selectedSeries.key)}" data-riegel-expected-pace-distance="${escapeHtml(point.name)}" data-tooltip="${escapeHtml(tooltip)}"></circle>
    `;
  }).join("");
  const currentDots = currentPoints.map((point) => {
    const tooltip = `Current ${selectedSeries.label} ${point.name}\n${formatClockDuration(point.actualTime)}\n${formatPaceWithUnit(point.actualPaceSecondsPerKm)}`;
    return `
      <circle cx="${x(point.distanceKm).toFixed(1)}" cy="${yPace(point.actualPaceSecondsPerKm).toFixed(1)}" r="4.2" fill="#17201a" stroke="#ffffff" stroke-width="1.8" data-riegel-current-pace-distance="${escapeHtml(point.name)}" data-tooltip="${escapeHtml(tooltip)}"></circle>
    `;
  }).join("");

  els.riegelExpectedPaceChart.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" style="height:${height}px" role="img" aria-label="${escapeHtml(`Riegel split pace and pace-gap bar chart by distance for ${selectedSeries.label}`)}" data-riegel-distance-scale="${escapeHtml(appState.riegelFiveKScale)}">
      ${grid}
      <text class="axis-label" data-riegel-axis-label="pace" x="${padding.left}" y="22">Pace (min/km)</text>
      <text class="axis-label" data-riegel-axis-label="gap" x="${padding.left}" y="${gapPanel.top - 32}">Pace Gap (sec/km)</text>
      <text class="axis-label" x="${width - padding.right}" y="${gapPanel.top + 14}" text-anchor="end" style="fill:#24724f">Current faster</text>
      <text class="axis-label" x="${width - padding.right}" y="${gapPanel.bottom - 6}" text-anchor="end" style="fill:#b24b3f">Current slower</text>
      <text class="axis-label" data-riegel-axis-label="distance" x="${padding.left + chartWidth / 2}" y="${height - 8}" text-anchor="middle">Distance (km)</text>
      ${legend}
      ${distanceLabels}
      <g data-riegel-panel="pace">
        ${paceConnectors}
        <path d="${expectedPath}" fill="none" stroke="${selectedSeries.color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"></path>
        ${currentPath ? `<path d="${currentPath}" fill="none" stroke="#17201a" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"></path>` : ""}
        ${expectedDots}
        ${currentDots}
      </g>
      <g data-riegel-panel="gap">
        ${gapBars}
      </g>
    </svg>
  `;
}

function formatPaceGapLabel(secondsPerKm) {
  if (!Number.isFinite(secondsPerKm)) return "-";
  const rounded = Math.round(secondsPerKm);
  if (!rounded) return "match";
  const sign = rounded > 0 ? "+" : "-";
  return `${sign}${formatPace(Math.abs(rounded))}/km`;
}

function formatPaceGapTick(secondsPerKm) {
  if (!Number.isFinite(secondsPerKm)) return "-";
  const rounded = Math.round(secondsPerKm);
  if (!rounded) return "0";
  const sign = rounded > 0 ? "+" : "-";
  return `${sign}${formatPace(Math.abs(rounded))}`;
}

function formatHeatmapDistanceLabel(name) {
  const labels = {
    "Half-Marathon": "Half",
    Marathon: "Mara",
    "10 mile": "10mi",
    "1/2 mile": "1/2mi",
    "1 mile": "1mi",
    "2 mile": "2mi"
  };
  return labels[name] || name;
}

function formatExpectedVsCurrentLabel(deltaSeconds, seriesLabel) {
  if (!Number.isFinite(deltaSeconds)) return `No current ${seriesLabel} record`;
  const rounded = Math.round(deltaSeconds);
  if (!rounded) return `Matches current ${seriesLabel}`;
  const direction = rounded < 0 ? "faster" : "slower";
  return `${formatClockDuration(Math.abs(rounded))} ${direction} than current ${seriesLabel}`;
}

function getPersonalBestByName(rankIndex = 0) {
  const map = new Map();
  for (const distance of appState.personalBests?.distances || []) {
    const effort = distance.top?.[rankIndex];
    if (!effort) continue;
    map.set(distance.name, {
      name: distance.name,
      distanceKm: Number(distance.distanceKm || 0),
      time: Number(effort.movingTime || 0),
      paceSecondsPerKm: Number(effort.paceSecondsPerKm || 0),
      rank: rankIndex + 1,
      startDate: effort.startDate,
      startDateLocal: effort.startDateLocal
    });
  }
  return map;
}

function getPersonalBestEffortsByName(name) {
  const distance = (appState.personalBests?.distances || []).find((item) => item.name === name);
  return distance?.top || [];
}

function getRiegelSourceDistanceOptions(rankIndex = 0, riegelExponent = appState.riegelExponent) {
  const actualOptions = Array.from(getPersonalBestByName(rankIndex).values())
    .filter((item) => Number.isFinite(item.distanceKm) && item.distanceKm > 0 && Number.isFinite(item.time) && item.time > 0)
    .sort((a, b) => a.distanceKm - b.distanceKm);
  const optionsByName = new Map(actualOptions.map((item) => [item.name, item]));
  if (!actualOptions.length || !isValidRiegelExponent(riegelExponent)) {
    return actualOptions;
  }

  for (const target of getRiegelProjectionTargets()) {
    const targetDistanceKm = Number(target.distanceKm || 0);
    if (optionsByName.has(target.name) || !Number.isFinite(targetDistanceKm) || targetDistanceKm <= 0) continue;
    const predictedTimes = actualOptions
      .map((item) => predictRiegelTime(item.time, item.distanceKm, targetDistanceKm, riegelExponent))
      .filter((value) => Number.isFinite(value) && value > 0);
    const predictedTime = median(predictedTimes);
    if (!Number.isFinite(predictedTime) || predictedTime <= 0) continue;
    optionsByName.set(target.name, {
      name: target.name,
      distanceKm: targetDistanceKm,
      time: predictedTime,
      paceSecondsPerKm: predictedTime / targetDistanceKm,
      rank: rankIndex + 1,
      isPredicted: true
    });
  }

  return Array.from(optionsByName.values())
    .sort((a, b) => a.distanceKm - b.distanceKm || a.name.localeCompare(b.name));
}

function resolveRiegelSourceDistance(sourceOptions) {
  const preferred = appState.riegelSourceDistanceName;
  const selected = sourceOptions.find((item) => item.name === preferred)
    || sourceOptions.find((item) => item.name === "5K")
    || sourceOptions.find((item) => item.distanceKm >= 3)
    || sourceOptions[0]
    || null;
  return selected;
}

function getRiegelExponentSources(rankIndex = 0) {
  return (appState.personalBests?.distances || [])
    .map((distance) => {
      const effort = distance.top?.[rankIndex];
      const distanceKm = Number(distance.distanceKm || 0);
      const time = Number(effort?.movingTime || 0);
      if (!distanceKm || distanceKm < MIN_RIEGEL_EXPONENT_DISTANCE_KM || !time) return null;
      return {
        name: distance.name,
        distanceKm,
        time,
        paceSecondsPerKm: Number(effort.paceSecondsPerKm || 0),
        startDate: effort.startDate,
        startDateLocal: effort.startDateLocal
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.distanceKm - b.distanceKm);
}

function getSelectedRiegelSeries() {
  const selected = getPersonalBestSeriesDefinitions().find((item) => item.key === appState.riegelFiveKSeries);
  return selected || getPersonalBestSeriesDefinitions()[0];
}

function isRiegelChartSourceTarget(target) {
  return target instanceof Element && Boolean(target.closest("#riegelFiveKChart [data-riegel-source-name]"));
}

function handleRiegelChartSourceClick(event) {
  if (!isRiegelChartSourceTarget(event.target)) return;
  const target = event.target.closest("#riegelFiveKChart [data-riegel-source-name]");
  const sourceName = target?.getAttribute("data-riegel-source-name");
  const activeSourceName = appState.activeRiegelSourceDistanceName || appState.riegelSourceDistanceName;
  if (!sourceName || sourceName === activeSourceName) return;

  const selectedSeries = getSelectedRiegelSeries();
  const isAvailable = getRiegelSourceDistanceOptions(selectedSeries.index)
    .some((item) => item.name === sourceName);
  if (!isAvailable) return;

  appState.riegelSourceDistanceName = sourceName;
  saveRiegelSourceDistanceName(sourceName);
  renderRiegelAnalysis();
  toast(`Baseline changed to ${sourceName}.`);
}

function predictRiegelTime(sourceTime, sourceDistanceKm, targetDistanceKm, exponent) {
  return sourceTime * Math.pow(targetDistanceKm / sourceDistanceKm, exponent);
}

function renderPersonalBestChart() {
  for (const button of els.personalBestScaleButtons) {
    button.classList.toggle("active", button.dataset.scale === appState.personalBestScale);
  }

  const distances = appState.personalBests?.distances || [];
  const series = buildPersonalBestSeries();

  const values = series.flatMap((item) => item.points.map((point) => point.paceSecondsPerKm));
  const plottedDistances = series.flatMap((item) => item.points.map((point) => point.distanceKm));
  const minDistance = Math.min(...plottedDistances);
  const maxDistance = Math.max(...plottedDistances);
  if (!values.length || !Number.isFinite(minDistance) || !Number.isFinite(maxDistance) || !maxDistance) {
    els.personalBestChartCaption.textContent = "No data";
    return renderEmpty(els.personalBestChart, "No personal best pace data");
  }

  const useLogScale = appState.personalBestScale === "log" && minDistance > 0 && maxDistance > minDistance;
  els.personalBestChartCaption.textContent = "";

  const width = 980;
  const height = 318;
  const padding = { top: 24, right: 28, bottom: 48, left: 62 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const minPace = Math.floor(Math.min(...values) / 15) * 15;
  const maxPace = Math.ceil(Math.max(...values) / 15) * 15;
  const paceSpread = Math.max(maxPace - minPace, 30);
  const xMin = useLogScale ? minDistance : 0;
  const xMax = useLogScale ? maxDistance : Math.ceil(maxDistance / 5) * 5;
  const logMin = useLogScale ? Math.log(xMin) : 0;
  const logSpread = useLogScale ? Math.max(Math.log(xMax) - logMin, 0.0001) : 1;

  const x = (distanceKm) => {
    if (!useLogScale) return padding.left + (distanceKm / xMax) * chartWidth;
    return padding.left + ((Math.log(distanceKm) - logMin) / logSpread) * chartWidth;
  };
  const y = (pace) => padding.top + ((pace - minPace) / paceSpread) * chartHeight;
  const xTicks = getDistanceTicks({ useLogScale, minDistance, maxDistance, xMax });
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((ratio) => minPace + ratio * paceSpread);

  const grid = [
    ...xTicks.map((tick) => {
      const tickX = x(tick);
      return `
        <line x1="${tickX}" x2="${tickX}" y1="${padding.top}" y2="${height - padding.bottom}" stroke="#e5e9e3"></line>
        <text class="axis-label" x="${tickX}" y="${height - 18}" text-anchor="middle">${formatDistanceTick(tick)}</text>
      `;
    }),
    ...yTicks.map((tick) => {
      const tickY = y(tick);
      return `
        <line x1="${padding.left}" x2="${width - padding.right}" y1="${tickY}" y2="${tickY}" stroke="#d9dfd7"></line>
        <text class="axis-label" x="10" y="${tickY + 4}">${formatPace(tick)}</text>
      `;
    })
  ].join("");

  const lines = series.map((item) => {
    if (item.points.length < 2) return "";
    const path = item.points
      .map((point, index) => `${index ? "L" : "M"} ${x(point.distanceKm).toFixed(1)} ${y(point.paceSecondsPerKm).toFixed(1)}`)
      .join(" ");
    const dashAttribute = item.dashArray ? ` stroke-dasharray="${item.dashArray}"` : "";
    const strokeWidth = item.strokeWidth || 3;
    const dots = item.points.map((point) => `
      <circle cx="${x(point.distanceKm)}" cy="${y(point.paceSecondsPerKm)}" r="${item.dotRadius || 4}" fill="${item.dotFill || item.color}" stroke="${item.dotStroke || item.color}" stroke-width="${item.dotStrokeWidth || 0}" data-tooltip="${escapeHtml(formatPersonalBestPaceTooltip(item, point))}"></circle>
    `).join("");
    return `
      <path d="${path}" fill="none" stroke="${item.color}" stroke-width="${strokeWidth}"${dashAttribute} stroke-linecap="round" stroke-linejoin="round"></path>
      ${dots}
    `;
  }).join("");

  const legend = series.map((item, index) => {
    const xPosition = padding.left + index * 112;
    const dashAttribute = item.dashArray ? ` stroke-dasharray="${item.dashArray}"` : "";
    return `
      <g transform="translate(${xPosition}, 10)">
        <line x1="0" x2="22" y1="0" y2="0" stroke="${item.color}" stroke-width="${item.strokeWidth || 3}"${dashAttribute}></line>
        <text class="axis-label" x="28" y="4">${item.label}</text>
      </g>
    `;
  }).join("");

  els.personalBestChart.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Top 1, top 3, top 10, and median pace by distance">
      ${grid}
      <text class="axis-label" x="${padding.left + chartWidth / 2}" y="${height - 4}" text-anchor="middle">Distance (km)</text>
      <text class="axis-label" x="10" y="16">Pace</text>
      ${legend}
      ${lines}
    </svg>
  `;
}

function renderPersonalBestRecencyChart() {
  const newestSeries = buildPersonalBestRecencySeries("newest");
  const oldestSeries = buildPersonalBestRecencySeries("oldest");
  const series = [...oldestSeries, ...newestSeries];
  const datedSeries = series.map((item) => ({
    ...item,
    points: item.points
      .map((point) => {
        const recordedAt = getLocalFirstTimestamp(point.startDateLocal, point.startDate);
        if (!Number.isFinite(recordedAt)) return null;
        return { ...point, recordedAt };
      })
      .filter(Boolean)
  }));
  const plottedDistances = datedSeries.flatMap((item) => item.points.map((point) => point.distanceKm));
  const recordedDates = datedSeries.flatMap((item) => item.points.map((point) => point.recordedAt));
  const minDistance = Math.min(...plottedDistances);
  const maxDistance = Math.max(...plottedDistances);
  const today = startOfLocalDay(new Date());
  const todayTime = today.getTime();

  if (!recordedDates.length || !Number.isFinite(minDistance) || !Number.isFinite(maxDistance) || !Number.isFinite(todayTime)) {
    els.personalBestRecencyChartCaption.textContent = "No data";
    return renderEmpty(els.personalBestRecencyChart, "No personal best timing data");
  }

  const pointsWithDays = datedSeries.map((item) => ({
    ...item,
    points: item.points.map((point) => ({
      ...point,
      daysAgo: Math.max(0, Math.round((todayTime - startOfLocalDay(new Date(point.recordedAt)).getTime()) / (24 * 60 * 60 * 1000)))
    }))
  }));
  const maxDaysAgo = Math.max(...pointsWithDays.flatMap((item) => item.points.map((point) => point.daysAgo)), 1);
  const useLogScale = appState.personalBestScale === "log" && minDistance > 0 && maxDistance > minDistance;
  els.personalBestRecencyChartCaption.textContent = `As of ${formatDate(today)}`;

  const width = 980;
  const height = 318;
  const padding = { top: 24, right: 28, bottom: 48, left: 62 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const xMin = useLogScale ? minDistance : 0;
  const xMax = useLogScale ? maxDistance : Math.ceil(maxDistance / 5) * 5;
  const logMin = useLogScale ? Math.log(xMin) : 0;
  const logSpread = useLogScale ? Math.max(Math.log(xMax) - logMin, 0.0001) : 1;
  const yMax = Math.ceil(maxDaysAgo / 90) * 90 || 90;

  const x = (distanceKm) => {
    if (!useLogScale) return padding.left + (distanceKm / xMax) * chartWidth;
    return padding.left + ((Math.log(distanceKm) - logMin) / logSpread) * chartWidth;
  };
  const y = (daysAgo) => padding.top + (daysAgo / yMax) * chartHeight;
  const xTicks = getDistanceTicks({ useLogScale, minDistance, maxDistance, xMax });
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((ratio) => Math.round(yMax * ratio));

  const grid = [
    ...xTicks.map((tick) => {
      const tickX = x(tick);
      return `
        <line x1="${tickX}" x2="${tickX}" y1="${padding.top}" y2="${height - padding.bottom}" stroke="#e5e9e3"></line>
        <text class="axis-label" x="${tickX}" y="${height - 18}" text-anchor="middle">${formatDistanceTick(tick)}</text>
      `;
    }),
    ...yTicks.map((tick) => {
      const tickY = y(tick);
      return `
        <line x1="${padding.left}" x2="${width - padding.right}" y1="${tickY}" y2="${tickY}" stroke="#d9dfd7"></line>
        <text class="axis-label" x="8" y="${tickY + 4}">${formatDDay(tick)}</text>
      `;
    })
  ].join("");

  const lines = pointsWithDays.map((item) => {
    if (item.points.length < 2) return "";
    const path = item.points
      .map((point, index) => `${index ? "L" : "M"} ${x(point.distanceKm).toFixed(1)} ${y(point.daysAgo).toFixed(1)}`)
      .join(" ");
    const isOldest = item.boundary === "oldest";
    const dots = item.points.map((point) => `
      <circle cx="${x(point.distanceKm)}" cy="${y(point.daysAgo)}" r="${isOldest ? 5 : 4}" fill="${isOldest ? "var(--surface)" : item.color}" stroke="${item.color}" stroke-width="${isOldest ? 2 : 0}" data-tooltip="${escapeHtml(`${item.label} ${item.boundaryLabel} ${point.distanceName}\n${formatDDay(point.daysAgo)} · #${point.rank}\n${formatDate(point.startDateLocal || point.startDate)}`)}"></circle>
    `).join("");
    return `
      <path d="${path}" fill="none" stroke="${item.color}" stroke-width="${isOldest ? 2.4 : 3}" ${isOldest ? "stroke-dasharray=\"8 6\"" : ""} stroke-linecap="round" stroke-linejoin="round"></path>
      ${dots}
    `;
  }).join("");

  const colorLegend = getPersonalBestSeriesDefinitions().map((item, index) => {
    const xPosition = padding.left + index * 96;
    return `
      <g transform="translate(${xPosition}, 10)">
        <line x1="0" x2="22" y1="0" y2="0" stroke="${item.color}" stroke-width="3"></line>
        <text class="axis-label" x="28" y="4">${item.label}</text>
      </g>
    `;
  }).join("");
  const styleLegend = `
    <g transform="translate(${padding.left + 312}, 10)">
      <line x1="0" x2="22" y1="0" y2="0" stroke="#59635b" stroke-width="3"></line>
      <text class="axis-label" x="28" y="4">Newest</text>
    </g>
    <g transform="translate(${padding.left + 386}, 10)">
      <line x1="0" x2="22" y1="0" y2="0" stroke="#59635b" stroke-width="2.4" stroke-dasharray="8 6"></line>
      <circle cx="11" cy="0" r="4" fill="var(--surface)" stroke="#59635b" stroke-width="2"></circle>
      <text class="axis-label" x="28" y="4">Oldest</text>
    </g>
  `;

  els.personalBestRecencyChart.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Top 1, top 3, and top 10 personal best timing by distance">
      ${grid}
      <text class="axis-label" x="${padding.left + chartWidth / 2}" y="${height - 4}" text-anchor="middle">Distance (km)</text>
      <text class="axis-label" x="10" y="16">D-day</text>
      ${colorLegend}
      ${styleLegend}
      ${lines}
    </svg>
  `;
}

function renderPersonalBestTrendChart() {
  appState.personalBestTrendLimit = normalizePersonalBestTrendLimit(appState.personalBestTrendLimit);
  updatePersonalBestTrendLimitButtons();
  const distances = getPersonalBestTrendDistances();
  const selected = resolvePersonalBestTrendDistance(distances);
  renderPersonalBestTrendDistanceOptions(distances, selected?.name || null);

  if (!selected) {
    els.personalBestTrendCaption.textContent = "";
    return renderEmpty(els.personalBestTrendChart, "No trend data");
  }

  const selectedLimit = normalizePersonalBestTrendLimit(appState.personalBestTrendLimit);
  const efforts = selected.trendEfforts;
  const activeEfforts = efforts.filter((effort) => effort.rank <= selectedLimit);
  const dates = efforts.map((effort) => effort.recordedAt);
  const minDate = Math.min(...dates);
  const maxDate = Math.max(...dates);
  const trend = buildPaceTrend(activeEfforts);
  const paceValues = efforts.map((effort) => effort.paceSecondsPerKm);
  if (trend) paceValues.push(trend.startPace, trend.endPace);
  const paceDomain = buildPaceAxisDomain(paceValues);

  const width = 980;
  const height = 318;
  const padding = { top: 48, right: 30, bottom: 42, left: 62 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const dateSpread = Math.max(maxDate - minDate, 1);
  const x = (date) => padding.left + ((date - minDate) / dateSpread) * chartWidth;
  const y = (pace) => padding.top + ((pace - paceDomain.min) / paceDomain.spread) * chartHeight;
  const trendLegendLabel = trend ? `Trend ${formatPaceTrendRate(trend.annualPaceChange)}` : "Trend";
  const contextLegendLabel = `Top ${PERSONAL_BEST_TREND_LIMIT}`;
  els.personalBestTrendCaption.textContent = "";

  const xTicks = getDateTicks(minDate, maxDate);
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((ratio) => paceDomain.min + ratio * paceDomain.spread);
  const grid = [
    ...xTicks.map((tick) => {
      const tickX = x(tick);
      return `
        <line x1="${tickX}" x2="${tickX}" y1="${padding.top}" y2="${height - padding.bottom}" stroke="#e5e9e3"></line>
        <text class="axis-label" x="${tickX}" y="${height - 18}" text-anchor="middle">${formatDate(tick)}</text>
      `;
    }),
    ...yTicks.map((tick) => {
      const tickY = y(tick);
      return `
        <line x1="${padding.left}" x2="${width - padding.right}" y1="${tickY}" y2="${tickY}" stroke="#d9dfd7"></line>
        <text class="axis-label" x="10" y="${tickY + 4}">${formatPace(tick)}</text>
      `;
    })
  ].join("");

  const contextPath = efforts
    .map((effort, index) => `${index ? "L" : "M"} ${x(effort.recordedAt).toFixed(1)} ${y(effort.paceSecondsPerKm).toFixed(1)}`)
    .join(" ");
  const activePath = activeEfforts.length > 1 ? activeEfforts
    .map((effort, index) => `${index ? "L" : "M"} ${x(effort.recordedAt).toFixed(1)} ${y(effort.paceSecondsPerKm).toFixed(1)}`)
    .join(" ") : "";
  const dots = efforts.map((effort) => `
    <circle cx="${x(effort.recordedAt)}" cy="${y(effort.paceSecondsPerKm)}" r="${effort.rank <= selectedLimit ? "4" : "3.4"}" fill="#24724f" stroke="#ffffff" stroke-width="1.5" opacity="${effort.rank <= selectedLimit ? "1" : "0.24"}" data-tooltip="${escapeHtml(`${selected.name} #${effort.rank}${effort.rank <= selectedLimit ? "" : ` · outside top ${selectedLimit}`}\n${formatDate(effort.startDateLocal || effort.startDate)} · ${formatPaceWithUnit(effort.paceSecondsPerKm)}\n${formatClockDuration(effort.movingTime)} · ${effort.activityName || "Untitled"}`)}"></circle>
  `).join("");
  const trendPath = trend ? `
    <path d="M ${x(activeEfforts[0].recordedAt).toFixed(1)} ${y(trend.startPace).toFixed(1)} L ${x(activeEfforts.at(-1).recordedAt).toFixed(1)} ${y(trend.endPace).toFixed(1)}" fill="none" stroke="#c7672f" stroke-width="2.6" stroke-dasharray="8 6" stroke-linecap="round"></path>
  ` : "";
  const legend = `
    <g transform="translate(${padding.left}, 22)">
      <line x1="0" x2="22" y1="0" y2="0" stroke="#24724f" stroke-width="3"></line>
      <text class="axis-label" x="28" y="4">Selected Bests</text>
    </g>
    <g transform="translate(${padding.left + 170}, 22)">
      <line x1="0" x2="22" y1="0" y2="0" stroke="#24724f" stroke-width="3" opacity="0.22"></line>
      <text class="axis-label" x="28" y="4">${escapeHtml(contextLegendLabel)}</text>
    </g>
    <g transform="translate(${padding.left + 278}, 22)">
      <line x1="0" x2="22" y1="0" y2="0" stroke="#c7672f" stroke-width="2.6" stroke-dasharray="8 6"></line>
      <text class="axis-label" x="28" y="4">${escapeHtml(trendLegendLabel)}</text>
    </g>
  `;

  els.personalBestTrendChart.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(`${selected.name} personal best trend by date, ${trendLegendLabel}`)}">
      ${grid}
      ${legend}
      <path d="${contextPath}" fill="none" stroke="#24724f" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" opacity="0.18"></path>
      ${activePath ? `<path d="${activePath}" fill="none" stroke="#24724f" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"></path>` : ""}
      ${trendPath}
      ${dots}
    </svg>
  `;
}

function getTimeBestTrendDurations() {
  return (appState.personalBests?.durations || [])
    .map((duration) => {
      const trendEfforts = (duration.top || [])
        .slice(0, PERSONAL_BEST_TREND_LIMIT)
        .map((effort, index) => {
          const recordedAt = getLocalFirstTimestamp(effort.startDateLocal, effort.startDate);
          const distanceKm = Number(effort.distanceKm || 0);
          const paceSecondsPerKm = Number(effort.paceSecondsPerKm || 0);
          if (
            !Number.isFinite(recordedAt) ||
            !Number.isFinite(distanceKm) ||
            distanceKm <= 0 ||
            !Number.isFinite(paceSecondsPerKm) ||
            paceSecondsPerKm <= 0
          ) return null;
          return { ...effort, rank: index + 1, recordedAt, distanceKm, paceSecondsPerKm };
        })
        .filter(Boolean)
        .sort((a, b) => a.recordedAt - b.recordedAt || a.rank - b.rank);
      return { ...duration, trendEfforts };
    })
    .filter((duration) => duration.trendEfforts.length >= 2);
}

function updateTimeBestTrendLimitButtons() {
  for (const button of els.timeBestTrendLimitButtons || []) {
    button.classList.toggle("active", Number(button.dataset.limit) === appState.timeBestTrendLimit);
  }
}

function resolveTimeBestTrendDuration(durations) {
  if (!durations.length) {
    appState.timeBestTrendDurationName = null;
    return null;
  }

  const selected = durations.find((duration) => duration.name === appState.timeBestTrendDurationName);
  if (selected) return selected;

  const fallback = durations.find((duration) => duration.name === "30 min") || durations[0];
  appState.timeBestTrendDurationName = fallback.name;
  return fallback;
}

function renderTimeBestTrendDurationOptions(durations, selectedName) {
  if (!els.timeBestTrendDurationSelect) return;
  els.timeBestTrendDurationSelect.disabled = !durations.length;
  els.timeBestTrendDurationSelect.innerHTML = durations.map((duration) => `
    <option value="${escapeHtml(duration.name)}"${duration.name === selectedName ? " selected" : ""}>${escapeHtml(duration.name)}</option>
  `).join("");
}

function getPersonalBestTrendDistances() {
  return (appState.personalBests?.distances || [])
    .map((distance) => {
      const trendEfforts = (distance.top || [])
        .slice(0, PERSONAL_BEST_TREND_LIMIT)
        .map((effort, index) => {
          const recordedAt = getLocalFirstTimestamp(effort.startDateLocal, effort.startDate);
          if (!Number.isFinite(recordedAt) || !Number.isFinite(effort.paceSecondsPerKm)) return null;
          return { ...effort, rank: index + 1, recordedAt };
        })
        .filter(Boolean)
        .sort((a, b) => a.recordedAt - b.recordedAt || a.rank - b.rank);
      return { ...distance, trendEfforts };
    })
    .filter((distance) => distance.trendEfforts.length >= 2);
}

function normalizePersonalBestTrendLimit(value) {
  const limit = Number(value);
  return PERSONAL_BEST_TREND_LIMIT_OPTIONS.has(limit) ? limit : PERSONAL_BEST_TREND_LIMIT;
}

function updatePersonalBestTrendLimitButtons() {
  for (const button of els.personalBestTrendLimitButtons || []) {
    button.classList.toggle("active", Number(button.dataset.limit) === appState.personalBestTrendLimit);
  }
}

function resolvePersonalBestTrendDistance(distances) {
  if (!distances.length) {
    appState.personalBestTrendDistanceName = null;
    return null;
  }

  const selected = distances.find((distance) => distance.name === appState.personalBestTrendDistanceName);
  if (selected) return selected;

  const fallback = distances.find((distance) => distance.name === "5K") || distances[0];
  appState.personalBestTrendDistanceName = fallback.name;
  return fallback;
}

function renderPersonalBestTrendDistanceOptions(distances, selectedName) {
  els.personalBestTrendDistanceSelect.disabled = !distances.length;
  els.personalBestTrendDistanceSelect.innerHTML = distances.map((distance) => `
    <option value="${escapeHtml(distance.name)}"${distance.name === selectedName ? " selected" : ""}>${escapeHtml(distance.name)}</option>
  `).join("");
}

function buildPaceTrend(efforts) {
  if (efforts.length < 2) return null;
  const firstDate = efforts[0].recordedAt;
  const xs = efforts.map((effort, index) => {
    const days = (effort.recordedAt - firstDate) / (24 * 60 * 60 * 1000);
    return days || index;
  });
  const ys = efforts.map((effort) => effort.paceSecondsPerKm);
  const xAverage = sum(xs, (value) => value) / xs.length;
  const yAverage = sum(ys, (value) => value) / ys.length;
  const denominator = sum(xs, (value) => (value - xAverage) ** 2);
  if (!denominator) return null;
  const numerator = xs.reduce((total, value, index) => total + (value - xAverage) * (ys[index] - yAverage), 0);
  const slope = numerator / denominator;
  const intercept = yAverage - slope * xAverage;
  const startX = xs[0];
  const endX = xs.at(-1);
  const startPace = intercept + slope * startX;
  const endPace = intercept + slope * endX;
  return { startPace, endPace, annualPaceChange: slope * YEAR_DAYS };
}

function getDateTicks(minDate, maxDate) {
  if (minDate === maxDate) return [minDate];
  return [minDate, minDate + (maxDate - minDate) / 2, maxDate];
}

function buildPersonalBestSeries() {
  const distances = appState.personalBests?.distances || [];
  return getPersonalBestPaceSeriesDefinitions().map((item) => ({
    ...item,
    points: distances
      .map((distance) => {
        if (item.key === "median") {
          const effort = distance.median;
          if (!effort || !Number.isFinite(effort.paceSecondsPerKm)) return null;
          return {
            distanceKm: Number(distance.distanceKm || 0),
            paceSecondsPerKm: effort.paceSecondsPerKm,
            distanceName: distance.name,
            time: effort.movingTime,
            count: effort.count || distance.count || 0
          };
        }

        const effort = distance.top?.[item.index];
        if (!effort || !Number.isFinite(effort.paceSecondsPerKm)) return null;
        return {
          distanceKm: Number(distance.distanceKm || 0),
          paceSecondsPerKm: effort.paceSecondsPerKm,
          distanceName: distance.name,
          time: effort.movingTime,
          startDate: effort.startDate,
          startDateLocal: effort.startDateLocal
        };
      })
      .filter((point) => point && point.distanceKm > 0)
  }));
}

function formatPersonalBestPaceTooltip(series, point) {
  const summary = `${series.label} ${point.distanceName}\n${formatPaceWithUnit(point.paceSecondsPerKm)}\n${formatClockDuration(point.time)}`;
  if (series.key !== "median") return summary;
  return `${summary} · based on all ${formatInteger(point.count)} best efforts`;
}

function buildPersonalBestRecencySeries(boundary) {
  const distances = appState.personalBests?.distances || [];
  const boundaryLabel = boundary === "oldest" ? "oldest" : "newest";
  return getPersonalBestSeriesDefinitions().map((item) => ({
    ...item,
    boundary,
    boundaryLabel,
    points: distances
      .map((distance) => {
        const selectedEffort = (distance.top || [])
          .slice(0, item.limit)
          .map((effort, index) => ({
            ...effort,
            rank: index + 1,
            recordedAt: getLocalFirstTimestamp(effort.startDateLocal, effort.startDate)
          }))
          .filter((effort) => Number.isFinite(effort.recordedAt))
          .sort((a, b) => boundary === "oldest" ? a.recordedAt - b.recordedAt : b.recordedAt - a.recordedAt)[0];

        if (!selectedEffort) return null;
        return {
          distanceKm: Number(distance.distanceKm || 0),
          paceSecondsPerKm: selectedEffort.paceSecondsPerKm,
          distanceName: distance.name,
          time: selectedEffort.movingTime,
          startDate: selectedEffort.startDate,
          startDateLocal: selectedEffort.startDateLocal,
          activityName: selectedEffort.activityName,
          rank: selectedEffort.rank
        };
      })
      .filter((point) => point && point.distanceKm > 0)
  }));
}

function buildTimeBestDistanceSeries() {
  const durations = appState.personalBests?.durations || [];
  return getPersonalBestPaceSeriesDefinitions().map((item) => ({
    ...item,
    points: durations
      .map((duration) => {
        if (item.key === "median") {
          const effort = duration.median;
          if (!effort || !Number.isFinite(effort.distanceKm) || !Number.isFinite(effort.paceSecondsPerKm)) return null;
          return {
            durationSeconds: Number(duration.durationSeconds || 0),
            durationName: duration.name,
            distanceKm: Number(effort.distanceKm || 0),
            paceSecondsPerKm: Number(effort.paceSecondsPerKm || 0),
            count: effort.count || duration.count || 0
          };
        }

        const effort = duration.top?.[item.index];
        if (!effort || !Number.isFinite(effort.distanceKm) || !Number.isFinite(effort.paceSecondsPerKm)) return null;
        return {
          durationSeconds: Number(duration.durationSeconds || 0),
          durationName: duration.name,
          distanceKm: Number(effort.distanceKm || 0),
          paceSecondsPerKm: Number(effort.paceSecondsPerKm || 0),
          startDate: effort.startDate,
          startDateLocal: effort.startDateLocal
        };
      })
      .filter((point) => point && point.durationSeconds > 0 && point.distanceKm > 0 && point.paceSecondsPerKm > 0)
  }));
}

function formatTimeBestPaceTooltip(series, point) {
  const summary = `${series.label} ${point.durationName}\n${formatPaceWithUnit(point.paceSecondsPerKm)}\n${formatNumber(point.distanceKm, 2)} km`;
  if (series.key !== "median") return summary;
  return `${summary} · based on all ${formatInteger(point.count)} time bests`;
}

function buildTimeBestRecencySeries(boundary) {
  const durations = appState.personalBests?.durations || [];
  const boundaryLabel = boundary === "oldest" ? "oldest" : "newest";
  return getPersonalBestSeriesDefinitions().map((item) => ({
    ...item,
    boundary,
    boundaryLabel,
    points: durations
      .map((duration) => {
        const selectedEffort = (duration.top || [])
          .slice(0, item.limit)
          .map((effort, index) => ({
            ...effort,
            rank: index + 1,
            recordedAt: getLocalFirstTimestamp(effort.startDateLocal, effort.startDate)
          }))
          .filter((effort) => Number.isFinite(effort.recordedAt))
          .sort((a, b) => boundary === "oldest" ? a.recordedAt - b.recordedAt : b.recordedAt - a.recordedAt)[0];

        if (!selectedEffort) return null;
        return {
          durationSeconds: Number(duration.durationSeconds || 0),
          durationName: duration.name,
          distanceKm: Number(selectedEffort.distanceKm || 0),
          paceSecondsPerKm: selectedEffort.paceSecondsPerKm,
          startDate: selectedEffort.startDate,
          startDateLocal: selectedEffort.startDateLocal,
          activityName: selectedEffort.activityName,
          rank: selectedEffort.rank
        };
      })
      .filter((point) => point && point.durationSeconds > 0)
  }));
}

function getTimeBestDurationTicks({ useLogScale, minDuration, maxDuration, xMax, durations }) {
  const fixedTicks = (durations || [])
    .map((duration) => ({
      name: duration.name,
      durationSeconds: Number(duration.durationSeconds || 0)
    }))
    .filter((duration) => duration.durationSeconds > 0);
  if (useLogScale) {
    return fixedTicks.filter((tick) => tick.durationSeconds >= minDuration && tick.durationSeconds <= maxDuration);
  }
  return fixedTicks.filter((tick) => tick.durationSeconds <= xMax);
}

function formatTimeBestTick(duration) {
  const seconds = Number(duration.durationSeconds || duration || 0);
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  const hours = seconds / 3600;
  return Number.isInteger(hours) ? `${hours}h` : `${formatNumber(hours, 1)}h`;
}

function getPersonalBestSeriesDefinitions() {
  return [
    { key: "top1", label: "Top 1", index: 0, limit: 1, color: "#24724f" },
    { key: "top3", label: "Top 3", index: 2, limit: 3, color: "#3266a8" },
    { key: "top10", label: "Top 10", index: 9, limit: 10, color: "#c7672f" }
  ];
}

function getPersonalBestPaceSeriesDefinitions() {
  return [
    ...getPersonalBestSeriesDefinitions(),
    {
      key: "median",
      label: "Median",
      color: "#59635b",
      dashArray: "7 5",
      strokeWidth: 2.6,
      dotRadius: 3.6,
      dotFill: "#ffffff",
      dotStroke: "#59635b",
      dotStrokeWidth: 1.8
    }
  ];
}

function getDistanceTicks({ useLogScale, minDistance, maxDistance, xMax }) {
  if (useLogScale) {
    return [0.4, 1, 2, 5, 10, 20, 30, 42.195, 50].filter((tick) => tick >= minDistance && tick <= maxDistance);
  }
  return Array.from({ length: Math.floor(xMax / 5) + 1 }, (_, index) => index * 5);
}

function buildPaceAxisDomain(values) {
  const paces = values.filter((value) => Number.isFinite(value));
  if (!paces.length) return { min: 0, max: 30, spread: 30 };
  const rawMin = Math.min(...paces);
  const rawMax = Math.max(...paces);
  const rawSpread = Math.max(rawMax - rawMin, 1);
  const padding = Math.max(rawSpread * 0.12, 8);
  const min = Math.floor((rawMin - padding) / 15) * 15;
  const max = Math.ceil((rawMax + padding) / 15) * 15;
  const spread = Math.max(max - min, 30);
  return { min, max: min + spread, spread };
}

function groupByWeek(activities, metric, range = getDashboardDateRange(activities)) {
  if (!range) return [];
  const map = new Map();
  const buckets = [];
  for (let end = range.end; end.getTime() >= range.start.getTime(); end = addLocalDays(buckets.at(-1).start, -1)) {
    const start = maxLocalDate(addLocalDays(end, -6), range.start);
    const bucket = ensureWeekBucket(map, start, end);
    buckets.push(bucket);
  }

  for (const activity of activities) {
    const date = getActivityLocalDay(activity);
    if (!date) continue;
    const item = buckets.find((bucket) => date >= bucket.start && date <= bucket.end);
    if (!item) continue;
    item.value += metric.getValue(activity);
    item.count += 1;
  }

  return Array.from(map.values()).sort((a, b) => a.key.localeCompare(b.key));
}

function ensureWeekBucket(map, start, end) {
  const key = localDateKey(start);
  if (!map.has(key)) {
    map.set(key, {
      key,
      start,
      end,
      label: `${formatShortDate(start)} - ${formatShortDate(end)}`,
      shortLabel: formatShortDate(start),
      value: 0,
      count: 0
    });
  }
  return map.get(key);
}

function maxLocalDate(a, b) {
  return a.getTime() >= b.getTime() ? a : b;
}

function getDashboardDateRange(activities = appState.activities) {
  if (appState.rangeDays !== "all") {
    const rangeDays = Number(appState.rangeDays);
    if (Number.isFinite(rangeDays) && rangeDays > 0) {
      const end = getDashboardRangeEndDate(activities);
      return {
        start: addLocalDays(end, -(rangeDays - 1)),
        end
      };
    }
  }

  const dates = activities.map(getActivityLocalDay).filter(Boolean).sort((a, b) => a - b);
  if (!dates.length) return null;
  return {
    start: dates[0],
    end: dates.at(-1)
  };
}

function getDashboardRangeEndDate(activities = appState.activities) {
  const today = startOfLocalDay(new Date());
  return hasRunOnLocalDate(activities, today) ? today : addLocalDays(today, -1);
}

function hasRunOnLocalDate(activities, date) {
  const key = localDateKey(date);
  return activities.some((activity) => {
    if (!isRun(activity)) return false;
    const activityDate = getActivityLocalDay(activity);
    return activityDate && localDateKey(activityDate) === key;
  });
}

function getPreviousDashboardDateRange(currentRange = getDashboardDateRange(appState.activities)) {
  if (appState.rangeDays === "all") return null;
  const rangeDays = Number(appState.rangeDays);
  if (!Number.isFinite(rangeDays) || rangeDays <= 0) return null;
  if (!currentRange) return null;
  const end = addLocalDays(currentRange.start, -1);
  return {
    start: addLocalDays(end, -(rangeDays - 1)),
    end
  };
}

function getActivitiesInDateRange(range) {
  if (!range) return [];
  return appState.activities.filter((activity) => {
    if (!isRun(activity)) return false;
    const date = getActivityLocalDay(activity);
    return date && date >= range.start && date <= range.end;
  });
}

function renderEmpty(container, text) {
  container.innerHTML = `<div class="chart-empty">${text}</div>`;
}

function isRun(activity) {
  const type = activity.sport_type || activity.type;
  return type === "Run" || type === "TrailRun" || type === "VirtualRun";
}

function formatSport(activity) {
  const type = activity.sport_type || activity.type || "Activity";
  const labels = {
    Run: "Run",
    TrailRun: "Trail Run",
    VirtualRun: "Virtual Run",
    Hike: "Hike",
    Walk: "Walk"
  };
  return labels[type] || type;
}

function formatPaceForActivity(activity) {
  const distanceKm = Number(activity.distance || 0) / 1000;
  const movingTime = Number(activity.moving_time || 0);
  if (!distanceKm || !movingTime) return "-";
  return formatPace(movingTime / distanceKm);
}

function formatPace(secondsPerKm) {
  if (!Number.isFinite(secondsPerKm)) return "-";
  const totalSeconds = Math.max(0, Math.round(secondsPerKm));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatPaceWithUnit(secondsPerKm) {
  const pace = formatPace(secondsPerKm);
  return pace === "-" ? pace : `${pace}/km`;
}

function formatPaceTrendRate(secondsPerKmPerYear) {
  const delta = formatDeltaPlain(secondsPerKmPerYear);
  return delta === "-" ? delta : `${delta}/yr`;
}

function formatDistanceTick(km) {
  return Number.isInteger(km) ? String(km) : formatNumber(km, km < 1 ? 1 : 3).replace(/0+$/, "").replace(/\.$/, "");
}

function formatDDay(days) {
  const rounded = Math.max(0, Math.round(Number(days) || 0));
  return `D-${formatInteger(rounded)}`;
}

function formatDelta(seconds) {
  if (!Number.isFinite(seconds)) return "-";
  const rounded = Math.round(seconds);
  const className = rounded > 0 ? "positive" : rounded < 0 ? "negative" : "";
  const sign = rounded > 0 ? "+" : rounded < 0 ? "-" : "";
  return `<span class="metric-delta ${className}">${sign}${formatClockDuration(Math.abs(rounded))}</span>`;
}

function formatDeltaPlain(seconds) {
  if (!Number.isFinite(seconds)) return "-";
  const rounded = Math.round(seconds);
  const sign = rounded > 0 ? "+" : rounded < 0 ? "-" : "";
  return `${sign}${formatClockDuration(Math.abs(rounded))}`;
}

function formatSignedDistanceKm(value) {
  if (!Number.isFinite(value)) return "-";
  const sign = value > 0 ? "+" : "";
  return `${sign}${formatNumber(value, 1)} km`;
}

function formatSignedInteger(value) {
  if (!Number.isFinite(value)) return "-";
  const sign = value > 0 ? "+" : "";
  return `${sign}${formatInteger(value)}`;
}

function formatSignedHours(value) {
  if (!Number.isFinite(value)) return "-";
  const sign = value > 0 ? "+" : "";
  return `${sign}${formatNumber(value, 1)} h`;
}

function formatSignedMeters(value) {
  if (!Number.isFinite(value)) return "-";
  const sign = value > 0 ? "+" : "";
  return `${sign}${formatInteger(Math.round(value))} m`;
}

function formatKpiDelta(value, formatter, preferredDirection = "higher") {
  if (!Number.isFinite(value)) return "-";
  const className = getKpiDeltaClass(value, preferredDirection);
  return `<span class="kpi-delta ${className}">${escapeHtml(formatter(value))}</span>`;
}

function getKpiDeltaClass(value, preferredDirection) {
  if (!value) return "neutral";
  if (preferredDirection === "lower") return value < 0 ? "positive" : "negative";
  return value > 0 ? "positive" : "negative";
}

function formatRiegelExponent(value) {
  return formatNumber(Number.isFinite(value) ? value : DEFAULT_RIEGEL_EXPONENT, 3);
}

function formatDuration(seconds) {
  const totalSeconds = Math.max(0, Math.round(Number(seconds) || 0));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (hours) return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  return `${minutes}m`;
}

function formatClockDuration(seconds) {
  const totalSeconds = Math.max(0, Math.round(Number(seconds) || 0));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const remainingSeconds = totalSeconds % 60;
  if (hours) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
  }
  return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}

function formatDate(value) {
  if (!value) return "-";
  const date = parseLocalDateTimeString(value) || parseDateValue(value);
  if (!date) return "-";
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function formatShortDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return `${date.getMonth() + 1}.${String(date.getDate()).padStart(2, "0")}`;
}

function startOfLocalDay(value) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

function getActivityStartTime(activity) {
  return getLocalFirstTimestamp(activity.start_date_local, activity.start_date);
}

function getLocalFirstTimestamp(localValue, fallbackValue) {
  const date = getLocalFirstDate(localValue, fallbackValue);
  return date ? date.getTime() : NaN;
}

function getLocalFirstDate(localValue, fallbackValue) {
  return parseLocalDateTimeString(localValue) || parseDateValue(fallbackValue) || parseDateValue(localValue);
}

function parseLocalDateTimeString(value) {
  if (typeof value !== "string") return null;

  const match = value.trim().match(
    /^(\d{4})-(\d{2})-(\d{2})(?:$|[T\s](\d{2})(?::(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?)?(?:Z|[+-]\d{2}:?\d{2})?$)/
  );
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hours = Number(match[4] || 0);
  const minutes = Number(match[5] || 0);
  const seconds = Number(match[6] || 0);
  const milliseconds = match[7] ? Number(match[7].padEnd(3, "0")) : 0;
  if (
    month < 1 || month > 12 ||
    hours > 23 ||
    minutes > 59 ||
    seconds > 59
  ) {
    return null;
  }

  const date = new Date(year, month - 1, day, hours, minutes, seconds, milliseconds);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  return date;
}

function parseDateValue(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("en-US", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function formatNumber(value, digits = 0) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits
  }).format(Number.isFinite(value) ? value : 0);
}

function formatInteger(value) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(Number(value) || 0);
}

function selectedRangeLabel() {
  const selected = els.rangeSelect.options[els.rangeSelect.selectedIndex];
  return selected ? selected.textContent : "All";
}

function sum(items, mapper) {
  return items.reduce((total, item) => total + Number(mapper(item) || 0), 0);
}

function median(values) {
  const sorted = values
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2) return sorted[middle];
  return (sorted[middle - 1] + sorted[middle]) / 2;
}

function setLoading(loading) {
  appState.loading = loading;
  updateActionButtons();
}

function setSyncing(syncing) {
  appState.syncing = syncing;
  updateActionButtons();
}

function setDetailSyncing(syncing) {
  appState.detailSyncing = syncing;
  updateActionButtons();
}

function setActivityRefreshing(activityId) {
  appState.refreshingActivityId = activityId ? String(activityId) : null;
  updateActionButtons();
  if (appState.currentView === "pb") renderPersonalBests();
  if (appState.currentView === "time") renderTimeBestsView();
  if (appState.currentView === "dashboard" && appState.activityListOpen) renderAllActivities();
}

function setRecordExcluding(recordKey) {
  appState.excludingRecordKey = recordKey ? String(recordKey) : null;
  updateActionButtons();
  if (appState.currentView === "pb") renderPersonalBests();
  if (appState.currentView === "time") renderTimeBestsView();
}

function setConfigSaving(configSaving) {
  appState.configSaving = configSaving;
  updateActionButtons();
}

function updateActionButtons() {
  const status = appState.status || {};
  const busy = appState.loading || appState.syncing || appState.detailSyncing || appState.configSaving || Boolean(appState.refreshingActivityId) || Boolean(appState.excludingRecordKey);

  els.connectButton.disabled = busy || status.configured === false;
  els.syncButton.disabled = busy || !status.connected;
  els.clearButton.disabled = busy;
  els.stravaConfigSaveButton.disabled = busy;
  els.syncButton.textContent = appState.syncing || appState.detailSyncing ? "Syncing" : "Sync";
  els.stravaConfigSaveButton.textContent = appState.configSaving ? "Saving" : "Save Settings";
  updateExcludedRecordsToggleButtons(busy);
}

function updateExcludedRecordsToggleButtons(disabled = false) {
  for (const button of els.excludedRecordsToggleButtons || []) {
    button.disabled = disabled;
    button.classList.toggle("active", appState.includeExcludedRecords);
    button.textContent = appState.includeExcludedRecords ? "Hide Excluded" : "Include Excluded";
    button.setAttribute("aria-pressed", appState.includeExcludedRecords ? "true" : "false");
  }
}

function handleChartTooltip(event) {
  if (!(event.target instanceof Element)) return;
  const target = event.target.closest("[data-tooltip]");
  if (!target) return;
  els.chartTooltip.textContent = target.dataset.tooltip || "";
  els.chartTooltip.classList.add("show");
  positionChartTooltip(event);
}

function positionChartTooltip(event) {
  const margin = 14;
  const rect = els.chartTooltip.getBoundingClientRect();
  let left = event.clientX + margin;
  let top = event.clientY + margin;
  if (left + rect.width > window.innerWidth - margin) left = event.clientX - rect.width - margin;
  if (top + rect.height > window.innerHeight - margin) top = event.clientY - rect.height - margin;
  els.chartTooltip.style.left = `${Math.max(margin, left)}px`;
  els.chartTooltip.style.top = `${Math.max(margin, top)}px`;
}

function hideChartTooltip() {
  els.chartTooltip.classList.remove("show");
}

function toast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("show");
  window.clearTimeout(toast.timer);
  toast.timer = window.setTimeout(() => {
    els.toast.classList.remove("show");
  }, 3600);
}

function showAuthResult() {
  const params = new URLSearchParams(window.location.search);
  const auth = params.get("auth");
  if (!auth) return;

  const messages = {
    connected: "Strava connection complete.",
    missing_config: "Strava app setup is required.",
    invalid_state: "Could not verify authentication state.",
    missing_code: "Authentication code is missing.",
    denied: "Strava connection was canceled.",
    token_error: "Token exchange failed."
  };
  window.history.replaceState({}, document.title, window.location.pathname);
  window.setTimeout(() => toast(messages[auth] || "Authentication flow finished."), 200);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
