const localApi = window.location.protocol === "file:" || ["localhost", "127.0.0.1"].includes(window.location.hostname);
const API_BASE = new URLSearchParams(window.location.search).get("api") || (localApi
  ? "http://127.0.0.1:8787/labs/v1"
  : `${window.location.origin}/api/labs/v1`);
const DEMO_STATE = new URLSearchParams(window.location.search).get("state") || "";
const CLIENT_ID = "cl-01";
const START_DATE = "2026-07-26";
const AVITO_PRICE = 8000;
const periods = { channels: "30d", avito: "30d" };

const el = (id) => document.getElementById(id);
let clientRecord = null;
let leadRows = null;
let apiStale = false;

function apiUrl(path) {
  const url = new URL(`${API_BASE.replace(/\/$/, "")}/${path}`);
  if (DEMO_STATE) url.searchParams.set("state", DEMO_STATE);
  return url.href;
}

async function getJson(path) {
  let response;
  try {
    response = await fetch(apiUrl(path), { cache: "no-store" });
  } catch {
    throw new ApiProblem("network");
  }

  // 202 is technically a 2xx response, but this API uses it to mean "still collecting".
  if (response.status === 202 || !response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new ApiProblem(response.status, payload);
  }

  const data = await response.json();
  if (data.stale === true || DEMO_STATE === "stale") apiStale = true;
  return data;
}

class ApiProblem extends Error {
  constructor(status, payload = {}) {
    super(payload.error || "Ошибка запроса");
    this.status = status;
    this.retryAfter = Number(payload.retry_after) || 15;
  }
}

function dateOnly(value) {
  return new Date(`${value}T00:00:00`);
}

function isoDate(value) {
  const d = new Date(value);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(dateString, count) {
  const date = dateOnly(dateString);
  date.setDate(date.getDate() + count);
  return isoDate(date);
}

function humanDate(dateString, withYear = false) {
  if (!dateString) return "—";
  const date = dateOnly(dateString);
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    ...(withYear ? { year: "numeric" } : {}),
  }).format(date);
}

function number(value) {
  return new Intl.NumberFormat("ru-RU").format(value);
}

function money(value) {
  return `${number(value)} ₽/мес`;
}

function periodRange(period) {
  if (period === "30d") {
    const end = addDays(START_DATE, -1);
    return { from: addDays(end, -29), to: end };
  }
  return { from: null, to: addDays(START_DATE, -1) };
}

function filterPeriod(rows, period) {
  const range = periodRange(period);
  return rows.filter((lead) => {
    if (!lead.date || lead.date >= START_DATE) return false;
    return !range.from || lead.date >= range.from;
  });
}

function observedRange(rows) {
  const dates = rows.map((row) => row.date).filter(Boolean).sort();
  return dates.length ? { from: dates[0], to: dates.at(-1) } : null;
}

function periodCaption(rows, period) {
  const range = periodRange(period);
  const observed = observedRange(rows);
  if (!observed) {
    return period === "30d"
      ? `Период анализа: ${humanDate(range.from)} — ${humanDate(range.to, true)} · заявок нет`
      : "Период анализа: данных пока нет";
  }
  if (period === "30d") {
    return `Период анализа: ${humanDate(range.from)} — ${humanDate(range.to, true)}`;
  }
  return `Период анализа: ${humanDate(observed.from)} — ${humanDate(observed.to, true)}`;
}

function groupedCounts(rows) {
  const map = new Map();
  rows.forEach((lead) => {
    const key = lead.channel || "Канал не указан";
    if (!map.has(key)) map.set(key, { channel: key, total: 0, target: 0, junk: 0, unknown: 0 });
    const group = map.get(key);
    group.total += 1;
    if (lead.is_junk === "да") group.junk += 1;
    else if (lead.is_junk === "нет") group.target += 1;
    else group.unknown += 1;
  });
  return map;
}

function percent(numerator, denominator) {
  if (!denominator) return null;
  return numerator / denominator * 100;
}

function percentText(value) {
  if (value === null || !Number.isFinite(value)) return "—";
  return `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 }).format(value)}%`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]);
}

function renderClient(client) {
  if (!client) {
    el("page-title").textContent = "Не удалось загрузить данные клиента";
    el("page-title").classList.remove("loading-text");
    el("client-meta").textContent = "Обновите страницу или повторите запрос";
    return;
  }
  el("page-title").textContent = client.brand || "Клиент не указан";
  el("page-title").classList.remove("loading-text");
  el("client-meta").textContent = [client.niche, client.city].filter(Boolean).join(" · ") || "Профиль клиента";
}

function renderAnalysisPeriod(rows) {
  const range = observedRange(filterPeriod(rows, "all"));
  el("analysis-period-value").textContent = range
    ? `${humanDate(range.from)} — ${humanDate(range.to, true)}`
    : "Данные отсутствуют";
}

function renderFinding(allRows, period) {
  const rows = filterPeriod(allRows, period);
  const channels = groupedCounts(rows);
  const avito = channels.get("Авито") || { total: 0, junk: 0, target: 0 };

  if (!rows.length) {
    el("finding-title").textContent = "За выбранный период обращений нет";
    el("finding-description").textContent = "Выберите другой период, чтобы оценить долю Авито и качество заявок";
    return;
  }

  if (avito.total) {
    el("finding-title").textContent = "Главная проблема: нецелевые заявки с Авито";
    el("finding-description").textContent = `Авито — основной канал привлечения для вас: с него приходит ${percentText(percent(avito.total, rows.length))} всех обращений. При этом ${percentText(percent(avito.junk, avito.total))} обращений с Авито — нецелевые`;
  } else {
    el("finding-title").textContent = "В выбранном периоде нет обращений с Авито";
    el("finding-description").textContent = `В этом срезе нельзя оценить долю Авито и нецелевых обращений. Всего поступило ${number(rows.length)} обращений`;
  }
}

function renderChannels(allRows, period) {
  const rows = filterPeriod(allRows, period);
  const groups = groupedCounts(rows);
  const allChannels = [...new Set(allRows.map((lead) => lead.channel || "Канал не указан"))];
  const sortedChannels = allChannels.sort((a, b) => (groups.get(b)?.total || 0) - (groups.get(a)?.total || 0) || a.localeCompare(b, "ru"));
  el("channels-period").textContent = periodCaption(rows, period);

  if (!rows.length) {
    el("channels-rows").innerHTML = "";
    el("channels-total").innerHTML = "";
    return;
  }

  el("channels-rows").innerHTML = sortedChannels.map((channel) => {
    const item = groups.get(channel) || { total: 0, target: 0, junk: 0, unknown: 0 };
    const rate = percent(item.target, item.total - item.unknown);
    return `<tr>
      <td class="channel-name">${escapeHtml(channel)}</td>
      <td class="numeric">${number(item.total)}</td>
      <td class="numeric">${number(item.target)}</td>
      <td class="numeric">${number(item.junk)}${item.unknown ? ` <span class="muted-count">(+${number(item.unknown)} не размечено)</span>` : ""}</td>
      <td class="numeric channel-share">${percentText(rate)}</td>
    </tr>`;
  }).join("");

  const target = rows.filter((lead) => lead.is_junk === "нет").length;
  const junk = rows.filter((lead) => lead.is_junk === "да").length;
  const unknown = rows.length - target - junk;
  const totalRate = percent(target, target + junk);
  el("channels-total").innerHTML = `<tr><td>Всего</td><td class="numeric">${number(rows.length)}</td><td class="numeric">${number(target)}</td><td class="numeric">${number(junk)}${unknown ? ` (+${number(unknown)} не размечено)` : ""}</td><td class="numeric channel-share">${percentText(totalRate)}</td></tr>`;
}

function renderAvito(allRows, period) {
  const rows = filterPeriod(allRows, period);
  const avito = rows.filter((lead) => lead.channel === "Авито");
  const junk = avito.filter((lead) => lead.is_junk === "да");
  const targets = avito.filter((lead) => lead.is_junk === "нет");
  const reasons = new Map();
  junk.forEach((lead) => {
    const reason = lead.junk_reason?.trim() || "Причина не указана";
    reasons.set(reason, (reasons.get(reason) || 0) + 1);
  });

  el("avito-period").textContent = periodCaption(avito, period);
  el("avito-junk-rate").textContent = percentText(percent(junk.length, avito.length));
  el("avito-junk-count").textContent = `${number(junk.length)} / ${number(avito.length)}`;
  const reasonEntries = [...reasons.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ru"));
  const max = Math.max(1, ...reasonEntries.map(([, count]) => count));
  el("reason-list").innerHTML = reasonEntries.length
    ? reasonEntries.map(([reason, count]) => `<li class="reason-item"><span class="reason-item__label">${escapeHtml(reason)}</span><span class="reason-bar" aria-hidden="true"><span class="reason-bar__fill" style="width:${count / max * 100}%"></span></span><span class="reason-item__count">${number(count)}</span></li>`).join("")
    : '<li class="empty-reasons">Нецелевых обращений за выбранный период нет</li>';
}

function renderOffer(client) {
  el("addon-fee").textContent = money(AVITO_PRICE);
  const feeValue = client?.monthly_fee;
  const fee = feeValue === null || feeValue === undefined || feeValue === "" ? Number.NaN : Number(feeValue);
  if (!Number.isFinite(fee) || fee < 0) {
    el("base-fee").textContent = "уточнить";
    el("combined-fee").textContent = "уточнить";
    return;
  }
  el("base-fee").textContent = money(fee);
  el("combined-fee").textContent = money(fee + AVITO_PRICE);
}

function renderAddonEvidence(rows) {
  if (!Array.isArray(rows)) {
    el("addon-rate").textContent = "—";
    el("addon-count").textContent = "нецелевых обращений с Авито за последние 30 дней";
    el("addon-rationale").textContent = "Данных недостаточно, чтобы обосновать отдельную настройку Авито";
    return;
  }

  const leads = filterPeriod(rows, "30d");
  const avito = leads.filter((lead) => lead.channel === "Авито");
  const junk = avito.filter((lead) => lead.is_junk === "да");
  if (!avito.length) {
    el("addon-rate").textContent = "—";
    el("addon-count").textContent = "нецелевых обращений с Авито за последние 30 дней";
    el("addon-rationale").textContent = "За последние 30 дней заявок с Авито нет, долю нецелевых рассчитать нельзя";
    return;
  }
  el("addon-rate").textContent = percentText(percent(junk.length, avito.length));
  el("addon-count").textContent = "нецелевых обращений с Авито за последние 30 дней";
  if (!junk.length) {
    el("addon-rationale").textContent = "За последние 30 дней нецелевых обращений не было, оснований для отдельной настройки по этому срезу нет";
    return;
  }
  const reasonCounts = new Map();
  junk.forEach((lead) => {
    const reason = lead.junk_reason?.trim() || "Причина не указана";
    reasonCounts.set(reason, (reasonCounts.get(reason) || 0) + 1);
  });
  const reasonLabels = {
    "спрашивали вакансии": "вопросы о вакансиях",
    "не тот город": "обращения из другого города",
    "дубль заявки": "дубли заявок",
    "реклама услуг": "предложения рекламы",
  };
  const reasonEntries = [...reasonCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ru"))
    .map(([reason]) => reasonLabels[reason] || reason.toLowerCase());
  const causes = reasonEntries.length > 1
    ? `${reasonEntries.slice(0, -1).join(", ")} и ${reasonEntries.at(-1)}`
    : reasonEntries[0];
  el("addon-rationale").textContent = reasonEntries.length
    ? `Среди нецелевых обращений отмечены: ${causes}. Эти причины учитываем при настройке объявлений`
    : "Причины обращений подскажут, что проверить в настройках объявлений";
}

function showProblem(container, problem, section) {
  const messages = {
    network: { kind: "error", title: "Не удалось обновить данные", body: "Проверьте подключение и повторите запрос" },
    202: { kind: "loading", title: "Данные ещё собираются", body: `Попробуйте снова через ${problem.retryAfter} сек` },
    403: { kind: "error", title: "Нет доступа к данным клиента", body: "Проверьте права доступа и повторите запрос" },
    429: { kind: "error", title: "Слишком много запросов", body: `Повторите попытку через ${problem.retryAfter} сек` },
  };
  const message = messages[problem.status] || {
    kind: "error",
    title: "Не удалось загрузить данные",
    body: "Попробуйте повторить запрос позже",
  };
  const isLoading = message.kind === "loading";
  container.innerHTML = `<div class="state-message ${isLoading ? "" : "state-message--error"}" role="status">
    <div><strong>${message.title}</strong><p>${message.body}</p></div>
    <button class="state-message__retry" type="button" data-retry>Повторить</button>
  </div>`;
  container.querySelector("[data-retry]").addEventListener("click", load);
  if (section === "client") renderClient(null);
}

function showEmpty(container, section) {
  const copy = section === "client"
    ? ["Данные клиента пока недоступны", "Обновите страницу или проверьте доступ к профилю"]
    : ["Заявок за этот период нет", "Выберите другой период, чтобы проверить наличие обращений"];
  container.innerHTML = `<div class="state-message state-message--empty" role="status"><div><strong>${copy[0]}</strong><p>${copy[1]}</p></div></div>`;
}

function setStaleNotice() {
  if (!apiStale) return;
  el("stale-state").innerHTML = '<div class="state-message state-message--stale" role="status"><div><strong>Не удалось обновить данные</strong><p>Показан последний доступный срез. Перед обсуждением сверьте период</p></div></div>';
}

function renderEmptyLeadSections() {
  showEmpty(el("channels-state"), "leads");
  el("channels-rows").innerHTML = "";
  el("channels-total").innerHTML = "";
  showEmpty(el("avito-state"), "leads");
  el("avito-content").classList.add("is-hidden");
}

function renderAll() {
  if (leadRows === null) return;
  el("channels-state").innerHTML = "";
  el("avito-state").innerHTML = "";
  el("avito-content").classList.remove("is-hidden");
  const allPreStartRows = filterPeriod(leadRows, "all");
  renderFinding(allPreStartRows, periods.channels);
  renderChannels(allPreStartRows, periods.channels);
  renderAvito(allPreStartRows, periods.avito);
  renderAddonEvidence(allPreStartRows);
  renderAnalysisPeriod(allPreStartRows);
}

async function load() {
  const reloadButton = el("reload-button");
  reloadButton.disabled = true;
  el("channels-state").innerHTML = '<div class="state-message"><div><strong>Загружаем обращения…</strong></div></div>';
  el("avito-state").innerHTML = '<div class="state-message"><div><strong>Загружаем заявки Авито…</strong></div></div>';

  apiStale = false;
  el("stale-state").innerHTML = "";
  const [clientResult, leadsResult] = await Promise.allSettled([
    getJson("clients?manager=%D0%98%D1%80%D0%B8%D0%BD%D0%B0"),
    getJson(`leads?client_id=${encodeURIComponent(CLIENT_ID)}&limit=500`),
  ]);

  if (clientResult.status === "fulfilled") {
    const clients = clientResult.value.items || [];
    clientRecord = clients.find((item) => item.client_id === CLIENT_ID) || null;
    if (clientRecord) {
      renderClient(clientRecord);
      renderOffer(clientRecord);
      el("client-state").innerHTML = "";
    } else {
      showEmpty(el("client-state"), "client");
      renderClient(null);
      renderOffer(null);
    }
  } else {
    showProblem(el("client-state"), clientResult.reason, "client");
    renderOffer(null);
  }

  if (leadsResult.status === "fulfilled") {
    leadRows = Array.isArray(leadsResult.value.items) ? leadsResult.value.items : [];
    const rows = filterPeriod(leadRows, "all");
    renderAnalysisPeriod(rows);
    if (rows.length) {
      renderAll();
    } else {
      renderFinding([], periods.channels);
      renderEmptyLeadSections();
      renderAddonEvidence(rows);
    }
  } else {
    leadRows = null;
    showProblem(el("channels-state"), leadsResult.reason, "leads");
    showProblem(el("avito-state"), leadsResult.reason, "leads");
    el("channels-rows").innerHTML = "";
    el("channels-total").innerHTML = "";
    el("avito-content").classList.add("is-hidden");
    el("finding-title").textContent = "Не удалось загрузить анализ";
    el("finding-description").textContent = "Обновите данные, чтобы увидеть распределение обращений по каналам";
    renderAddonEvidence(null);
  }
  setStaleNotice();
  reloadButton.disabled = false;
}

document.querySelectorAll(".period-switch").forEach((group) => {
  group.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-period]");
    if (!button) return;
    const groupName = group.dataset.periodGroup;
    periods[groupName] = button.dataset.period;
    group.querySelectorAll("button[data-period]").forEach((item) => {
      const active = item === button;
      item.classList.toggle("is-active", active);
      item.setAttribute("aria-pressed", String(active));
    });
    if (!leadRows) return;
    if (groupName === "channels") {
      const preStartRows = filterPeriod(leadRows, "all");
      renderFinding(preStartRows, periods.channels);
      renderChannels(preStartRows, periods.channels);
    } else {
      renderAvito(filterPeriod(leadRows, "all"), periods.avito);
    }
  });
});

const viewSwitch = document.querySelector(".view-switch");
viewSwitch.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-view]");
  if (!button) return;
  if (button.dataset.view === "report") {
    window.location.assign("report.html");
    return;
  }
  viewSwitch.dataset.active = button.dataset.view;
  viewSwitch.querySelectorAll("button[data-view]").forEach((item) => {
    const active = item === button;
    item.classList.toggle("is-active", active);
    item.setAttribute("aria-pressed", String(active));
  });
});

el("reload-button").addEventListener("click", load);
load();
