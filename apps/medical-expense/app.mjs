import {
  STORAGE_KEY,
  calculateSummary,
  emptyState,
  filterRecords,
  groupByPerson,
  normalizeRecord,
  normalizeState,
  toCsv,
} from "./core.mjs";
import {
  GEMINI_KEY_STORAGE,
  analyzeReceipt,
  prepareImage,
} from "./ai-receipt.mjs";

const $ = (selector) => document.querySelector(selector);
const yen = new Intl.NumberFormat("ja-JP", { style: "currency", currency: "JPY", maximumFractionDigits: 0 });
const currentYear = new Date().getFullYear();
let selectedYear = currentYear;
let state = loadState();
let syncStatus = "loading";
let cloudInitialized = false;
let preparedReceiptImage = null;
let receiptFiles = [];
let receiptIndex = 0;
let receiptReviewPending = false;
let cloudSync = {
  user: null,
  signIn: async () => { throw new Error("同期機能を利用できません。"); },
  signOut: async () => {},
  retry: async () => {},
  lastError: null,
};

const elements = {
  yearFilter: $("#yearFilter"),
  recordsList: $("#recordsList"),
  personBreakdown: $("#personBreakdown"),
  personFilter: $("#personFilter"),
  categoryFilter: $("#categoryFilter"),
  searchInput: $("#searchInput"),
  entryDialog: $("#entryDialog"),
  dataDialog: $("#dataDialog"),
  receiptDialog: $("#receiptDialog"),
  entryForm: $("#entryForm"),
  toast: $("#toast"),
};

initialize();

function initialize() {
  $("#todayLabel").textContent = new Intl.DateTimeFormat("ja-JP", {
    year: "numeric", month: "long", day: "numeric",
  }).format(new Date());
  populateYears();
  bindEvents();
  render();
  initializeCloudSync();
  registerServiceWorker();
  updateConnectionUi();
  handleLaunchAction();
}

function bindEvents() {
  ["#openEntryButton", "#desktopEntryButton", "#floatingEntryButton"].forEach((selector) => {
    $(selector).addEventListener("click", () => openEntryDialog());
  });
  ["#openReceiptButton", "#entryReceiptButton"].forEach((selector) => {
    $(selector).addEventListener("click", openReceiptDialog);
  });
  $("#settingsButton").addEventListener("click", openDataDialog);
  $("#accountButton").addEventListener("click", handleAccountAction);
  $("#incomeButton").addEventListener("click", openDataDialog);
  document.querySelectorAll("[data-close-dialog]").forEach((button) =>
    button.addEventListener("click", closeEntryDialog)
  );
  document.querySelectorAll("[data-close-data]").forEach((button) =>
    button.addEventListener("click", () => elements.dataDialog.close())
  );
  document.querySelectorAll("[data-close-receipt]").forEach((button) =>
    button.addEventListener("click", closeReceiptDialog)
  );
  elements.entryForm.addEventListener("submit", saveRecord);
  elements.entryForm.addEventListener("input", (event) => {
    event.target.removeAttribute("aria-invalid");
    if ($("#formError").textContent) $("#formError").textContent = "";
  });
  elements.yearFilter.addEventListener("change", () => {
    selectedYear = Number(elements.yearFilter.value);
    render();
  });
  [elements.personFilter, elements.categoryFilter].forEach((element) =>
    element.addEventListener("change", renderRecords)
  );
  elements.searchInput.addEventListener("input", renderRecords);
  elements.recordsList.addEventListener("click", handleRecordAction);
  $("#saveSettingsButton").addEventListener("click", saveSettings);
  $("#syncActionButton").addEventListener("click", handleAccountAction);
  $("#exportCsvButton").addEventListener("click", exportCsv);
  $("#exportJsonButton").addEventListener("click", exportJson);
  $("#importJsonInput").addEventListener("change", importJson);
  $("#deleteAllButton").addEventListener("click", deleteAll);
  $("#navHomeButton").addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));
  $("#navReceiptButton").addEventListener("click", openReceiptDialog);
  $("#navAddButton").addEventListener("click", () => openEntryDialog());
  $("#navSettingsButton").addEventListener("click", openDataDialog);
  $("#retrySyncButton").addEventListener("click", retrySync);
  window.addEventListener("online", updateConnectionUi);
  window.addEventListener("offline", updateConnectionUi);
  $("#receiptImageInput").addEventListener("change", handleReceiptImage);
  $("#changeReceiptButton").addEventListener("click", () => $("#receiptImageInput").click());
  $("#analyzeReceiptButton").addEventListener("click", handleReceiptAnalysis);
  elements.entryDialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeEntryDialog();
  });
  elements.receiptDialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeReceiptDialog();
  });
  [elements.entryDialog, elements.dataDialog, elements.receiptDialog].forEach((dialog) => {
    dialog.addEventListener("click", (event) => {
      if (event.target !== dialog) return;
      if (dialog === elements.entryDialog) closeEntryDialog();
      else if (dialog === elements.receiptDialog) closeReceiptDialog();
      else dialog.close();
    });
  });
}

function populateYears() {
  const recordYears = state.records.map((record) => Number(record.paidDate.slice(0, 4)));
  const minYear = Math.min(currentYear - 5, ...recordYears);
  const maxYear = Math.max(currentYear + 1, ...recordYears);
  elements.yearFilter.innerHTML = "";
  for (let year = maxYear; year >= minYear; year -= 1) {
    elements.yearFilter.add(new Option(`${year}年`, String(year), false, year === selectedYear));
  }
}

function render() {
  renderSummary();
  renderFilters();
  renderRecords();
  renderBreakdown();
  renderSuggestions();
}

function renderSummary() {
  const income = state.settings.incomesByYear[String(selectedYear)] ?? null;
  const summary = calculateSummary(state.records, selectedYear, income);
  $("#eligibleTotal").textContent = yen.format(summary.netEligible);
  $("#paidTotal").textContent = yen.format(summary.paid);
  $("#compensationTotal").textContent = yen.format(summary.compensation);
  $("#deductionTotal").textContent = yen.format(summary.deduction);
  $("#recordCount").textContent = `${summary.count}件の記録`;
  const remaining = Math.max(0, summary.threshold - summary.netEligible);
  $("#thresholdMessage").textContent = remaining
    ? `控除の目安まで ${yen.format(remaining)}`
    : `計算基準 ${yen.format(summary.threshold)} を超えています`;
  $("#thresholdProgress").style.width = `${Math.min(100, (summary.netEligible / Math.max(1, summary.threshold)) * 100)}%`;
}

function renderFilters() {
  const current = elements.personFilter.value;
  const people = unique(state.records
    .filter((record) => Number(record.paidDate.slice(0, 4)) === selectedYear)
    .map((record) => record.personName));
  elements.personFilter.innerHTML = '<option value="">家族全員</option>';
  people.forEach((person) => elements.personFilter.add(new Option(person, person)));
  elements.personFilter.value = people.includes(current) ? current : "";
}

function renderRecords() {
  const records = filterRecords(state.records, {
    year: selectedYear,
    person: elements.personFilter.value,
    category: elements.categoryFilter.value,
    query: elements.searchInput.value,
  });
  if (!records.length) {
    elements.recordsList.innerHTML = `
      <div class="empty-state">
        <span>＋</span>
        <strong>${state.records.length ? "条件に合う記録がありません" : "最初の医療費を記録しましょう"}</strong>
        <p>領収書を受け取った日に入力すると、年末の集計が楽になります。</p>
        <button class="text-button" type="button" data-action="new">医療費を記録する →</button>
      </div>`;
    return;
  }
  elements.recordsList.innerHTML = records.map((record) => {
    const total = record.amount + record.transportation;
    return `
      <article class="record-row">
        <div class="date-badge">
          <strong>${new Date(`${record.paidDate}T00:00:00`).getDate()}</strong>
          <span>${new Intl.DateTimeFormat("ja-JP", { month: "short" }).format(new Date(`${record.paidDate}T00:00:00`))}</span>
        </div>
        <div class="record-main">
          <div class="record-title">
            <strong>${escapeHtml(record.providerName)}</strong>
            ${record.eligible ? "" : '<span class="muted-badge">対象外</span>'}
          </div>
          <p>${escapeHtml(record.personName)} ・ ${escapeHtml(record.category)} ・ ${escapeHtml(record.receiptStatus)}</p>
          ${record.memo ? `<small>${escapeHtml(record.memo)}</small>` : ""}
        </div>
        <div class="record-amount">
          <strong>${yen.format(total)}</strong>
          ${record.compensation ? `<small>補てん ${yen.format(record.compensation)}</small>` : ""}
        </div>
        <div class="record-menu">
          <button class="icon-button" type="button" data-action="edit" data-id="${escapeHtml(record.id)}" aria-label="編集">•••</button>
          <div class="row-actions">
            <button type="button" data-action="edit" data-id="${escapeHtml(record.id)}">編集</button>
            <button type="button" data-action="delete" data-id="${escapeHtml(record.id)}">削除</button>
          </div>
        </div>
      </article>`;
  }).join("");
}

function renderBreakdown() {
  const breakdown = groupByPerson(state.records, selectedYear);
  if (!breakdown.length) {
    elements.personBreakdown.innerHTML = '<p class="muted-copy">記録すると家族別の合計が表示されます。</p>';
    return;
  }
  const max = Math.max(...breakdown.map((item) => item.total), 1);
  elements.personBreakdown.innerHTML = breakdown.map((item, index) => `
    <div class="breakdown-item">
      <div><span class="person-dot color-${index % 4}"></span><strong>${escapeHtml(item.name)}</strong><b>${yen.format(item.total)}</b></div>
      <span class="breakdown-bar"><i style="width:${(item.total / max) * 100}%"></i></span>
    </div>`).join("");
}

function renderSuggestions() {
  const people = unique(state.records.map((record) => record.personName));
  const providers = unique(state.records.map((record) => record.providerName));
  $("#personSuggestions").innerHTML = people.map((value) => `<option value="${escapeHtml(value)}"></option>`).join("");
  $("#providerSuggestions").innerHTML = providers.map((value) => `<option value="${escapeHtml(value)}"></option>`).join("");
}

function openEntryDialog(record = null) {
  elements.entryForm.reset();
  $("#formError").textContent = "";
  $("#recordId").value = record?.id || "";
  $("#entryDialogTitle").textContent = record ? "記録を編集" : "医療費を記録";
  $("#paidDate").value = record?.paidDate || localDateString();
  $("#personName").value = record?.personName || getLastPerson();
  $("#providerName").value = record?.providerName || "";
  $("#category").value = record?.category || "診療・治療";
  $("#paymentMethod").value = record?.paymentMethod || "現金";
  $("#amount").value = record?.amount ?? "";
  $("#compensation").value = record?.compensation || "";
  $("#transportation").value = record?.transportation || "";
  $("#receiptStatus").value = record?.receiptStatus || "保管済み";
  $("#eligible").checked = record?.eligible !== false;
  $("#memo").value = record?.memo || "";
  elements.entryDialog.showModal();
  window.setTimeout(() => $("#providerName").focus(), 50);
}

function openReceiptDialog({ preserveBatch = false } = {}) {
  if (elements.entryDialog.open) elements.entryDialog.close();
  if (!preserveBatch) {
    preparedReceiptImage = null;
    receiptFiles = [];
    receiptIndex = 0;
    receiptReviewPending = false;
    $("#receiptImageInput").value = "";
    $("#receiptConsent").checked = false;
  }
  $("#receiptError").textContent = "";
  $("#receiptProgress").hidden = true;
  $("#analyzeReceiptButton").disabled = false;
  $("#receiptPicker").hidden = receiptFiles.length > 0;
  $("#receiptPreview").hidden = receiptFiles.length === 0;
  if (receiptFiles.length) prepareCurrentReceipt();
  elements.receiptDialog.showModal();
}

async function handleReceiptImage(event) {
  const files = [...(event.target.files || [])];
  if (!files.length) return;
  receiptFiles = files;
  receiptIndex = 0;
  receiptReviewPending = false;
  await prepareCurrentReceipt();
}

async function prepareCurrentReceipt() {
  const file = receiptFiles[receiptIndex];
  if (!file) return;
  preparedReceiptImage = null;
  $("#receiptError").textContent = "";
  $("#receiptQueueLabel").textContent = `${receiptIndex + 1} / ${receiptFiles.length}枚目`;
  $("#receiptFileName").textContent = file.name;
  $("#receiptPicker").hidden = true;
  $("#receiptPreview").hidden = false;
  $("#receiptPreviewImage").removeAttribute("src");
  $("#analyzeReceiptButton").disabled = true;
  try {
    preparedReceiptImage = await prepareImage(file);
    $("#receiptPreviewImage").src = preparedReceiptImage.dataUrl;
  } catch (error) {
    $("#receiptError").textContent = error.message === "IMAGE_TOO_LARGE"
      ? "画像は10MB以下で選択してください。"
      : "この画像を読み込めませんでした。JPEGまたはPNGでお試しください。";
  } finally {
    $("#analyzeReceiptButton").disabled = !preparedReceiptImage;
  }
}

async function handleReceiptAnalysis() {
  const apiKey = localStorage.getItem(GEMINI_KEY_STORAGE) || "";
  if (!apiKey) {
    $("#receiptError").textContent = "先にデータ管理からGemini APIキーを設定してください。";
    return;
  }
  if (!preparedReceiptImage) {
    $("#receiptError").textContent = "領収書の写真を選択してください。";
    return;
  }
  if (!$("#receiptConsent").checked) {
    $("#receiptError").textContent = "画像の送信に同意してから読み取ってください。";
    $("#receiptConsent").focus();
    return;
  }
  $("#receiptError").textContent = "";
  $("#receiptProgress").hidden = false;
  $("#analyzeReceiptButton").disabled = true;
  try {
    const result = await analyzeReceipt({ apiKey, image: preparedReceiptImage });
    receiptReviewPending = true;
    elements.receiptDialog.close();
    openEntryDialog();
    if (result.paidDate) $("#paidDate").value = result.paidDate;
    $("#providerName").value = result.providerName;
    $("#amount").value = String(result.amount);
    $("#category").value = result.category;
    $("#paymentMethod").value = result.paymentMethod;
    $("#receiptStatus").value = "保管済み";
    const notes = [
      result.memo,
      result.warnings.length ? `AI確認事項: ${result.warnings.join(" / ")}` : "",
      `AI読取信頼度: ${Math.round(result.confidence * 100)}%`,
    ].filter(Boolean);
    $("#memo").value = notes.join("\n").slice(0, 300);
    $("#formError").textContent = "AIが入力した内容です。領収書と照合してから保存してください。";
    $("#providerName").focus();
    showToast("領収書から下書きを作成しました");
  } catch (error) {
    const messages = {
      INVALID_API_KEY: "Gemini APIキーが正しくありません。",
      MODEL_UNAVAILABLE: "AIが混み合っています。しばらくしてから再度お試しください。",
      INVALID_RESULT: "領収書の内容を十分に読み取れませんでした。明るい場所で撮り直してください。",
      EMPTY_RESULT: "AIから結果を受け取れませんでした。",
    };
    $("#receiptError").textContent = messages[error.message] || "AI読み取りに失敗しました。通信状態を確認してください。";
  } finally {
    $("#receiptProgress").hidden = true;
    $("#analyzeReceiptButton").disabled = false;
  }
}

async function saveRecord(event) {
  event.preventDefault();
  const requiredFields = [$("#paidDate"), $("#personName"), $("#providerName"), $("#amount")];
  const firstMissing = requiredFields.find((field) => !field.value.trim() || (field === $("#amount") && Number(field.value) <= 0));
  if (firstMissing) {
    firstMissing.setAttribute("aria-invalid", "true");
    $("#formError").textContent = "支払日、受診者、支払先、1円以上の金額を入力してください。";
    firstMissing.focus();
    return;
  }
  const id = $("#recordId").value || crypto.randomUUID();
  const previous = state.records.find((record) => record.id === id);
  const record = normalizeRecord({
    id,
    paidDate: $("#paidDate").value,
    personName: $("#personName").value,
    providerName: $("#providerName").value,
    category: $("#category").value,
    paymentMethod: $("#paymentMethod").value,
    amount: $("#amount").value,
    compensation: $("#compensation").value || 0,
    transportation: $("#transportation").value || 0,
    receiptStatus: $("#receiptStatus").value,
    eligible: $("#eligible").checked,
    memo: $("#memo").value,
    createdAt: previous?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  if (!record) {
    $("#formError").textContent = "支払日、受診者、支払先、1円以上の金額を入力してください。";
    return;
  }
  if (record.compensation > record.amount + record.transportation) {
    $("#compensation").setAttribute("aria-invalid", "true");
    $("#formError").textContent = "補てん金額は、この記録の医療費と交通費の合計以下で入力してください。";
    $("#compensation").focus();
    return;
  }
  if (cloudSync.user) {
    setSyncStatus("syncing");
    try {
      await cloudSync.saveRecord(record);
    } catch {
      setSyncStatus("error");
      $("#formError").textContent = "クラウドへ保存できませんでした。通信を確認して、もう一度保存してください。";
      return;
    }
  }
  state.records = previous
    ? state.records.map((item) => item.id === id ? record : item)
    : [...state.records, record];
  persist();
  selectedYear = Number(record.paidDate.slice(0, 4));
  populateYears();
  elements.yearFilter.value = String(selectedYear);
  elements.entryDialog.close();
  render();
  if (!previous && receiptReviewPending) {
    receiptReviewPending = false;
    receiptIndex += 1;
    if (receiptIndex < receiptFiles.length) {
      showToast(`${receiptIndex}枚目を登録しました。次の写真を確認します`);
      window.setTimeout(() => openReceiptDialog({ preserveBatch: true }), 250);
      return;
    }
    const count = receiptFiles.length;
    resetReceiptBatch();
    showToast(`${count}枚の領収書を登録しました`);
    return;
  }
  showToast(previous ? "記録を更新しました" : "医療費を記録しました");
}

function closeEntryDialog() {
  elements.entryDialog.close();
  if (receiptReviewPending) resetReceiptBatch();
}

function closeReceiptDialog() {
  elements.receiptDialog.close();
  resetReceiptBatch();
}

function resetReceiptBatch() {
  preparedReceiptImage = null;
  receiptFiles = [];
  receiptIndex = 0;
  receiptReviewPending = false;
  $("#receiptImageInput").value = "";
}

async function handleRecordAction(event) {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const action = button.dataset.action;
  if (action === "new") return openEntryDialog();
  const record = state.records.find((item) => item.id === button.dataset.id);
  if (!record) return;
  if (action === "edit") openEntryDialog(record);
  if (action === "delete" && window.confirm(`${record.providerName}の記録を削除しますか？`)) {
    if (cloudSync.user) {
      try {
        await cloudSync.deleteRecord(record.id);
      } catch {
        setSyncStatus("error");
        showToast("クラウドから削除できませんでした", true);
        return;
      }
    }
    state.records = state.records.filter((item) => item.id !== record.id);
    persist();
    render();
    showToast("記録を削除しました");
  }
}

function openDataDialog() {
  $("#incomeYearLabel").textContent = String(selectedYear);
  $("#incomeAmount").value = state.settings.incomesByYear[String(selectedYear)] ?? "";
  $("#geminiApiKey").value = localStorage.getItem(GEMINI_KEY_STORAGE) || "";
  renderSyncUi();
  elements.dataDialog.showModal();
}

async function saveSettings() {
  const raw = $("#incomeAmount").value;
  const income = raw === "" ? null : Number(raw);
  if (income !== null && (!Number.isFinite(income) || income < 0)) {
    showToast("所得金額は0円以上で入力してください", true);
    return;
  }
  const nextSettings = { incomesByYear: { ...state.settings.incomesByYear } };
  if (income === null) delete nextSettings.incomesByYear[String(selectedYear)];
  else nextSettings.incomesByYear[String(selectedYear)] = Math.round(income);
  if (cloudSync.user) {
    try {
      await cloudSync.saveSettings(nextSettings);
    } catch {
      setSyncStatus("error");
      showToast("クラウドへ設定を保存できませんでした", true);
      return;
    }
  }
  state.settings = nextSettings;
  const apiKey = $("#geminiApiKey").value.trim();
  if (apiKey) localStorage.setItem(GEMINI_KEY_STORAGE, apiKey);
  else localStorage.removeItem(GEMINI_KEY_STORAGE);
  persist();
  elements.dataDialog.close();
  renderSummary();
  showToast("設定を保存しました");
}

function exportCsv() {
  download(`medipass-${selectedYear}.csv`, toCsv(state.records, selectedYear), "text/csv;charset=utf-8");
  showToast(`${selectedYear}年分のCSVを書き出しました`);
}

function exportJson() {
  download(`medipass-backup-${localDateString()}.json`, JSON.stringify(state, null, 2), "application/json");
  showToast("バックアップを書き出しました");
}

async function importJson(event) {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;
  try {
    const imported = normalizeState(JSON.parse(await file.text()));
    const target = cloudSync.user ? "Google同期中の全端末データ" : "この端末のデータ";
    if (!window.confirm(`${target}を、${imported.records.length}件の記録で置き換えますか？`)) return;
    if (cloudSync.user) {
      setSyncStatus("syncing");
      await cloudSync.replaceAll(imported);
    }
    state = imported;
    persist();
    populateYears();
    render();
    elements.dataDialog.close();
    showToast("バックアップを復元しました");
  } catch {
    setSyncStatus(cloudSync.user ? "error" : "signed-out");
    showToast("バックアップを復元できませんでした", true);
  }
}

async function deleteAll() {
  if (!state.records.length) return showToast("削除する記録がありません", true);
  const target = cloudSync.user ? "Google同期中のすべての端末から" : "この端末から";
  if (!window.confirm(`${target}医療費記録を削除します。この操作は元に戻せません。`)) return;
  if (cloudSync.user) {
    try {
      setSyncStatus("syncing");
      await cloudSync.deleteAll();
    } catch {
      setSyncStatus("error");
      showToast("クラウドの記録を削除できませんでした", true);
      return;
    }
  }
  state.records = [];
  persist();
  render();
  elements.dataDialog.close();
  showToast("すべての記録を削除しました");
}

function loadState() {
  try {
    return normalizeState(JSON.parse(localStorage.getItem(STORAGE_KEY)));
  } catch {
    return emptyState();
  }
}

function persist() {
  if (!cloudSync.user) localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

async function handleAccountAction() {
  if (syncStatus === "loading" || syncStatus === "syncing" || syncStatus === "unavailable") return;
  try {
    if (cloudSync.user) {
      if (!window.confirm("この端末でGoogle同期を終了しますか？クラウド上の記録は削除されません。")) return;
      await cloudSync.signOut();
      showToast("Google同期を終了しました");
    } else {
      setSyncStatus("syncing");
      await cloudSync.signIn();
    }
  } catch (error) {
    setSyncStatus(cloudSync.user ? "error" : "signed-out");
    showToast(error?.message?.includes("popup-closed") ? "ログインをキャンセルしました" : "Googleログインに失敗しました", true);
  }
}

async function handleCloudChange(detail) {
  syncStatus = detail.status;
  cloudSync.lastError = detail.error;
  renderSyncUi();
  updateConnectionUi();
  if (detail.status === "signed-out" && cloudInitialized) {
    cloudInitialized = false;
    state = loadState();
    populateYears();
    render();
    return;
  }
  if (detail.status !== "synced") return;
  const cloudState = normalizeState(detail.state);
  if (!cloudInitialized) {
    cloudInitialized = true;
    const localOnlyRecords = state.records.filter((localRecord) =>
      !cloudState.records.some((cloudRecord) => cloudRecord.id === localRecord.id)
    );
    if (localOnlyRecords.length) {
      const shouldUpload = window.confirm(`この端末だけにある${localOnlyRecords.length}件の記録をGoogleへ追加しますか？`);
      if (shouldUpload) {
        try {
          await cloudSync.uploadRecords(localOnlyRecords);
          showToast(`${localOnlyRecords.length}件の端末データを同期しました`);
          return;
        } catch {
          setSyncStatus("error");
          showToast("端末データの同期に失敗しました", true);
          return;
        }
      }
    }
  }
  state = cloudState;
  populateYears();
  render();
}

async function initializeCloudSync() {
  try {
    const module = await import("./firebase-sync.mjs");
    cloudSync = module.cloudSync;
    cloudSync.subscribe(handleCloudChange);
  } catch {
    syncStatus = "unavailable";
    renderSyncUi();
    updateConnectionUi();
  }
}

function setSyncStatus(status) {
  syncStatus = status;
  renderSyncUi();
  updateConnectionUi();
}

function renderSyncUi() {
  const indicator = $("#syncIndicator");
  const accountLabel = $("#accountLabel");
  indicator.className = `sync-indicator ${syncStatus}`;
  $("#accountButton").setAttribute("aria-label", syncStatus === "synced" ? "Google同期済み。アカウント設定を開く" : "Google同期の設定を開く");
  if (cloudSync.user) {
    accountLabel.textContent = syncStatus === "synced" ? "同期済み" : syncStatus === "error" ? "同期エラー" : "同期中";
    $("#syncTitle").textContent = `${cloudSync.user.displayName || "Googleアカウント"}で同期中`;
    $("#syncDescription").textContent = cloudSync.user.email || "PCとスマホで同じ記録を利用できます。";
    $("#syncActionButton").textContent = "ログアウト";
    $("#privacyDescription").textContent = "記録はこの端末のブラウザとGoogleアカウントに紐づくクラウドへ保存されます。共有端末では利用後にログアウトしてください。";
  } else {
    accountLabel.textContent = syncStatus === "loading" ? "確認中" : syncStatus === "unavailable" ? "端末モード" : "Googleで同期";
    $("#syncTitle").textContent = "この端末だけで利用中";
    $("#syncDescription").textContent = "Googleでログインすると、PCとスマホで同じ記録を閲覧・編集できます。";
    $("#syncActionButton").textContent = syncStatus === "unavailable" ? "現在利用できません" : "Googleでログイン";
    $("#syncActionButton").disabled = syncStatus === "unavailable";
    $("#privacyDescription").textContent = "未ログイン時はブラウザ内に保存されます。Googleログイン中は、同じアカウントの端末で使えるようクラウドへ同期されます。共有端末では利用後にログアウトしてください。";
  }
}

async function retrySync() {
  if (!navigator.onLine) return showToast("インターネット接続を確認してください", true);
  try {
    setSyncStatus("syncing");
    await cloudSync.retry();
  } catch {
    setSyncStatus("error");
    updateConnectionUi();
  }
}

function updateConnectionUi() {
  const banner = $("#connectionBanner");
  const message = $("#connectionMessage");
  const retryButton = $("#retrySyncButton");
  if (!navigator.onLine) {
    banner.hidden = false;
    banner.className = "connection-banner offline";
    message.textContent = "オフラインです。端末モードの記録は利用できます。";
    retryButton.hidden = true;
    return;
  }
  if (syncStatus === "error") {
    const permissionDenied = cloudSync.lastError?.code?.includes("permission-denied");
    banner.hidden = false;
    banner.className = "connection-banner error";
    message.textContent = permissionDenied
      ? "クラウドのアクセス権を確認できませんでした。ログインし直してください。"
      : "クラウド同期に失敗しました。端末の記録は保持されています。";
    retryButton.hidden = false;
    return;
  }
  banner.hidden = true;
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator) || location.protocol === "file:") return;
  navigator.serviceWorker.register("./sw.js").catch(() => {
    // The app remains usable without offline caching.
  });
}

function handleLaunchAction() {
  const action = new URLSearchParams(location.search).get("action");
  if (!action) return;
  history.replaceState(null, "", location.pathname);
  window.setTimeout(() => {
    if (action === "scan") openReceiptDialog();
    if (action === "add") openEntryDialog();
  }, 100);
}

function download(filename, content, type) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([content], { type }));
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

function showToast(message, isError = false) {
  elements.toast.textContent = message;
  elements.toast.classList.toggle("error", isError);
  elements.toast.classList.add("show");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => elements.toast.classList.remove("show"), 2800);
}

function unique(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, "ja"));
}

function getLastPerson() {
  return [...state.records].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]?.personName || "本人";
}

function localDateString() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
