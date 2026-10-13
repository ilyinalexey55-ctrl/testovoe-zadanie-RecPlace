const localApi = window.location.protocol === "file:" || ["localhost", "127.0.0.1"].includes(window.location.hostname);
const API_BASE = new URLSearchParams(window.location.search).get("api") || (localApi
  ? "http://127.0.0.1:8787/labs/v1"
  : `${window.location.origin}/api/labs/v1`);
const DEMO_STATE = new URLSearchParams(window.location.search).get("state") || "";
const CLIENT_ID = "cl-01";
const el = (id) => document.getElementById(id);

class ApiProblem extends Error {
  constructor(status, payload = {}) {
    super(payload.error || "Ошибка запроса");
    this.status = status;
    this.retryAfter = Number(payload.retry_after) || 15;
  }
}

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
  if (response.status === 202 || !response.ok) {
    throw new ApiProblem(response.status, await response.json().catch(() => ({})));
  }
  return response.json();
}

function dateOnly(value) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function dateString(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(value, days) {
  const date = dateOnly(value);
  if (!date) return null;
  date.setUTCDate(date.getUTCDate() + days);
  return dateString(date);
}

function daysBetween(from, to) {
  return Math.round((dateOnly(to) - dateOnly(from)) / 86400000);
}

function humanDate(value, year = false) {
  const date = dateOnly(value);
  if (!date) return "дата не указана";
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    ...(year ? { year: "numeric" } : {}),
    timeZone: "UTC",
  }).format(date);
}

function count(value) {
  return new Intl.NumberFormat("ru-RU").format(value);
}

function pct(numerator, denominator) {
  return denominator > 0 ? numerator / denominator * 100 : null;
}

function pctText(value) {
  return value === null || !Number.isFinite(value)
    ? "—"
    : `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 }).format(value)}%`;
}

function rangeLabel(range) {
  if (!range?.from || !range?.to) return "период не определён";
  return `${humanDate(range.from)} — ${humanDate(range.to, true)}`;
}

function rateChangeCell(before, after) {
  if (before === null || after === null) return '<td class="rate-change" title="Для сравнения нужны заявки в обоих периодах">—</td>';
  const delta = Math.round((after - before) * 10) / 10;
  const trend = delta > 0 ? "up" : delta < 0 ? "down" : "flat";
  const sign = delta > 0 ? "+" : delta < 0 ? "−" : "";
  const value = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 }).format(Math.abs(delta));
  return `<td class="rate-change" data-trend="${trend}">${sign}${value}\u00a0п.\u00a0п.</td>`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]);
}

function buildWindows(rows, startDate) {
  const start = dateOnly(startDate);
  if (!start) return null;
  const postRows = rows.filter((row) => row.date >= startDate && row.date <= addDays(startDate, 29));
  const lastObserved = postRows.map((row) => row.date).filter((value) => dateOnly(value)).sort().at(-1);
  if (!lastObserved) {
    return {
      before: { from: addDays(startDate, -30), to: addDays(startDate, -1) },
      after: { from: startDate, to: addDays(startDate, 29) },
      observedAfter: null,
      duration: 30,
    };
  }
  const duration = Math.min(30, daysBetween(startDate, lastObserved) + 1);
  const beforeTo = addDays(startDate, -1);
  return {
    before: { from: addDays(beforeTo, -(duration - 1)), to: beforeTo },
    after: { from: startDate, to: addDays(startDate, 29) },
    observedAfter: lastObserved,
    duration,
  };
}

function rowsInRange(rows, range) {
  if (!range) return [];
  return rows.filter((row) => row.date >= range.from && row.date <= range.to);
}

function countsFor(rows) {
  const result = { total: 0, target: 0, junk: 0, unknown: 0 };
  rows.forEach((row) => {
    result.total += 1;
    if (row.is_junk === "да") result.junk += 1;
    else if (row.is_junk === "нет") result.target += 1;
    else result.unknown += 1;
  });
  result.classified = result.target + result.junk;
  result.junkRate = pct(result.junk, result.classified);
  return result;
}

function byChannel(rows) {
  const groups = new Map();
  rows.forEach((row) => {
    const channel = row.channel || "Канал не указан";
    if (!groups.has(channel)) groups.set(channel, []);
    groups.get(channel).push(row);
  });
  return groups;
}

function stateMarkup(kind, title, body, retry = true) {
  const button = retry ? '<button class="state-retry" type="button" data-retry>Повторить</button>' : "";
  return `<div class="state-message state-message--${kind}" role="status"><div><strong>${title}</strong><p>${body}</p></div>${button}</div>`;
}

function showApiProblem(slotId, problem) {
  const messages = {
    network: ["error", "Не удалось связаться с источником данных", "Проверьте подключение к API и повторите загрузку"],
    202: ["loading", "Данные ещё собираются", `Повторите загрузку через ${problem.retryAfter} сек`],
    403: ["error", "Нет доступа к данным клиента", "Проверьте доступ к клиенту и повторите запрос"],
    429: ["error", "Лимит запросов исчерпан", `Повторите загрузку через ${problem.retryAfter} сек`],
  };
  const [kind, title, body] = messages[problem.status] || ["error", "Не удалось загрузить данные", "Повторите запрос позже или проверьте источник данных"];
  el(slotId).innerHTML = stateMarkup(kind, title, body);
}

function showEmpty(slotId, title, body) {
  el(slotId).innerHTML = `<div class="state-empty" role="status"><strong>${title}</strong><br>${body}</div>`;
}

function renderClient(client) {
  if (!client) {
    el("client-name").textContent = "Данные клиента недоступны";
    el("client-meta").textContent = "Проверьте доступ к карточке клиента cl-01";
    el("service-start").textContent = "дата не указана";
    el("service-brief-title").textContent = "Услуга не определена";
    el("service-name-summary").textContent = "Дополнительная услуга";
    el("report-period").textContent = "Период не определён";
    el("promise-copy").textContent = "Обещание не удалось загрузить из карточки клиента";
    return;
  }
  el("client-name").textContent = client.brand || "Клиент без названия";
  el("client-meta").textContent = [client.niche, client.city].filter(Boolean).join(" · ") || "Профиль клиента";
  el("service-start").textContent = humanDate(client.service_started, true);
  el("service-brief-title").textContent = client.service_sold || "Услуга не указана";
  el("service-name-summary").textContent = client.service_sold || "Дополнительная услуга не указана";
  el("report-period").textContent = client.service_started
    ? `С ${humanDate(client.service_started, true)}` : "Начало работ не указано";
  const promise = client.promise?.trim().replace(/мусорных обращений/gi, "нецелевых обращений");
  el("promise-copy").textContent = promise
    ? `Задача: ${promise.charAt(0).toLocaleLowerCase("ru-RU")}${promise.slice(1)}`.replace(/\.$/, "")
    : "Обещание не зафиксировано в карточке клиента; оценить выполнение цели нельзя";
}

function renderChannelReport(rows, windows) {
  const beforeRows = rowsInRange(rows, windows.before);
  const afterRows = windows.observedAfter ? rowsInRange(rows, { from: windows.after.from, to: windows.observedAfter }) : [];
  if (!beforeRows.length && !afterRows.length) {
    showEmpty("channel-state", "Пока нет обращений для сравнения", "Когда появятся заявки до или после старта, здесь отобразится динамика по каналам");
    el("channel-content").hidden = true;
    return;
  }
  const beforeGroups = byChannel(beforeRows);
  const afterGroups = byChannel(afterRows);
  const channels = [...new Set([...beforeGroups.keys(), ...afterGroups.keys()])].sort((a, b) => a.localeCompare(b, "ru"));
  const totalBefore = countsFor(beforeRows);
  const totalAfter = countsFor(afterRows);
  el("channel-rows").innerHTML = channels.map((channel) => {
    const before = countsFor(beforeGroups.get(channel) || []);
    const after = countsFor(afterGroups.get(channel) || []);
    return `<tr><th scope="row">${escapeHtml(channel)}</th><td>${count(before.total)}</td><td>${count(before.target)}</td><td>${count(before.junk)}</td><td>${pctText(before.junkRate)}</td><td>${count(after.total)}</td><td>${count(after.target)}</td><td>${count(after.junk)}</td><td>${pctText(after.junkRate)}</td>${rateChangeCell(before.junkRate, after.junkRate)}</tr>`;
  }).join("");
  el("channel-total").innerHTML = `<tr><th scope="row">Все каналы</th><td>${count(totalBefore.total)}</td><td>${count(totalBefore.target)}</td><td>${count(totalBefore.junk)}</td><td>${pctText(totalBefore.junkRate)}</td><td>${count(totalAfter.total)}</td><td>${count(totalAfter.target)}</td><td>${count(totalAfter.junk)}</td><td>${pctText(totalAfter.junkRate)}</td>${rateChangeCell(totalBefore.junkRate, totalAfter.junkRate)}</tr>`;
  const change = totalBefore.junkRate === null || totalAfter.junkRate === null ? null : totalAfter.junkRate - totalBefore.junkRate;
  if (change === null) {
    el("channel-finding-title").textContent = "Пока недостаточно данных, чтобы сравнить качество обращений";
  } else {
    const direction = change > 0 ? "выросла" : change < 0 ? "снизилась" : "не изменилась";
    el("channel-finding-title").textContent = `Доля нецелевых обращений ${direction}: ${pctText(totalBefore.junkRate)}\u00a0→\u00a0${pctText(totalAfter.junkRate)}`;
  }
  el("channel-finding-copy").innerHTML = [
    ["Всего обращений", totalBefore.total, totalAfter.total],
    ["Целевые обращения", totalBefore.target, totalAfter.target],
    ["Нецелевые обращения", totalBefore.junk, totalAfter.junk],
  ].map(([label, previous, current]) => `<li>${label}: <strong>${count(previous)} → ${count(current)}</strong></li>`).join("");
  el("channel-period").textContent = `До старта: ${rangeLabel(windows.before)} · последний период: ${rangeLabel({ from: windows.after.from, to: windows.observedAfter || windows.after.to })}`;
  el("channel-note").textContent = totalBefore.unknown + totalAfter.unknown > 0
    ? `Доля рассчитывается среди заявок с известной классификацией. Без классификации: ${count(totalBefore.unknown)} до старта и ${count(totalAfter.unknown)} в последнем периоде`
    : "Доля нецелевых = нецелевые / (целевые + нецелевые)";
  el("channel-note").textContent += ". Изменение — разница долей в процентных пунктах: последний период минус период до старта. Плюс означает рост доли нецелевых, минус — снижение";
}

function renderHistory(history, startDate) {
  const before = history?.before;
  const after = history?.after;
  if (!before || !after || !Number.isFinite(Number(before.reviews_unanswered)) || !Number.isFinite(Number(after.reviews_unanswered))) {
    showEmpty("history-state", "Нет снимков для сравнения отзывов", "Для сравнения нужны данные на старте и на дату последнего снимка. Повторите загрузку после сбора данных");
    el("review-content").hidden = true;
    return;
  }
  const startCount = Number(before.reviews_unanswered);
  const endCount = Number(after.reviews_unanswered);
  el("reviews-status").textContent = endCount === 0 ? "Цель достигнута" : "Цель пока не достигнута";
  el("reviews-status").dataset.result = endCount === 0 ? "met" : "pending";
  el("review-content").hidden = false;
  el("reviews-insight").hidden = false;
  const delta = endCount - startCount;
  const decline = startCount > 0 ? (startCount - endCount) / startCount * 100 : null;
  el("reviews-before").textContent = count(startCount);
  el("reviews-after").textContent = count(endCount);
  el("reviews-before-date").textContent = humanDate(before.date || startDate, true);
  el("reviews-after-date").textContent = `Данные от ${humanDate(after.date, true)}`;
  el("reviews-change").textContent = `${delta > 0 ? "+" : ""}${count(delta)}`;
  el("reviews-change-note").textContent = decline === null ? "Исходное значение равно нулю" : `${decline >= 0 ? "снижение" : "рост"} на ${pctText(Math.abs(decline))}`;
  el("reviews-insight").textContent = endCount === 0
    ? "На дату отчёта отзывов без ответа не осталось"
    : `На дату отчёта без ответа остаётся ${count(endCount)} отзывов`;
}

function renderAvitoLeads(rows, windows, client) {
  el("junk-insight").hidden = false;
  const avito = rows.filter((row) => row.channel === "Авито");
  const beforeRows = rowsInRange(avito, windows.before);
  const afterRows = windows.observedAfter ? rowsInRange(avito, { from: windows.after.from, to: windows.observedAfter }) : [];
  const before = countsFor(beforeRows);
  const after = countsFor(afterRows);
  const targetRate = before.junkRate === null ? null : before.junkRate / 2;
  const canEvaluate = Boolean(client?.promise) && targetRate !== null && after.junkRate !== null;
  el("junk-status").textContent = canEvaluate
    ? (after.junkRate <= targetRate ? "Цель достигнута" : "Цель пока не достигнута")
    : "Недостаточно данных";
  el("junk-status").dataset.result = canEvaluate ? (after.junkRate <= targetRate ? "met" : "pending") : "unknown";
  el("junk-before-rate").textContent = pctText(before.junkRate);
  el("junk-target-rate").textContent = targetRate === null ? "—" : `≤ ${pctText(targetRate)}`;
  el("junk-after-rate").textContent = pctText(after.junkRate);
  el("junk-before-count").textContent = `Нецелевые: ${count(before.junk)} из ${count(before.classified)}`;
  el("junk-after-count").textContent = `Нецелевые: ${count(after.junk)} из ${count(after.classified)}`;
  el("avito-period").textContent = `До старта: ${rangeLabel(windows.before)} · последний период: ${rangeLabel({ from: windows.after.from, to: windows.observedAfter || windows.after.to })}`;
  el("service-period").textContent = `До старта: ${rangeLabel(windows.before)} · последние доступные обращения: ${rangeLabel({ from: windows.after.from, to: windows.observedAfter || windows.after.to })}`;

  if (!client?.promise) {
    el("junk-insight").textContent = "На дату отчёта выполнение цели нельзя оценить: обещание не зафиксировано в карточке клиента";
  } else if (targetRate === null || after.junkRate === null) {
    el("junk-insight").textContent = "На дату отчёта недостаточно классифицированных заявок, чтобы оценить выполнение обещания";
  } else {
    el("junk-insight").textContent = `На дату отчёта доля нецелевых обращений — ${pctText(after.junkRate)} при целевом уровне ${pctText(targetRate)} или ниже`;
  }

  const reasonCounts = (items) => {
    const map = new Map();
    items.filter((row) => row.is_junk === "да").forEach((row) => {
      const reason = row.junk_reason?.trim() || "Причина не указана";
      map.set(reason, (map.get(reason) || 0) + 1);
    });
    return map;
  };
  const reasonsBefore = reasonCounts(beforeRows);
  const reasonsAfter = reasonCounts(afterRows);
  const reasons = [...new Set([...reasonsBefore.keys(), ...reasonsAfter.keys()])]
    .sort((a, b) => (reasonsAfter.get(b) || 0) - (reasonsAfter.get(a) || 0) || a.localeCompare(b, "ru"));
  el("reason-rows").innerHTML = reasons.length
    ? reasons.map((reason) => {
      const previous = reasonsBefore.get(reason) || 0;
      const current = reasonsAfter.get(reason) || 0;
      const diff = current - previous;
      return `<tr><th scope="row">${escapeHtml(reason)}</th><td>${count(previous)}</td><td>${count(current)}</td><td>${diff > 0 ? "+" : ""}${count(diff)}</td></tr>`;
    }).join("")
    : '<tr><td colspan="4">В выбранных периодах нецелевые заявки с указанной причиной не найдены</td></tr>';
  const reasonChanges = reasons.map((reason) => ({
    reason,
    delta: (reasonsAfter.get(reason) || 0) - (reasonsBefore.get(reason) || 0),
    current: reasonsAfter.get(reason) || 0,
  })).filter((item) => item.delta !== 0)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || b.current - a.current || a.reason.localeCompare(b.reason, "ru"))
    .slice(0, 3);
  const reasonChangeText = reasonChanges.map((item) => `«${item.reason}» (${item.delta > 0 ? "+" : ""}${count(item.delta)})`).join(", ");
  el("reason-conclusion").textContent = !after.classified
    ? "На дату отчёта недостаточно классифицированных заявок, чтобы сравнить причины"
    : `На дату отчёта нецелевых заявок — ${count(after.junk)}, до старта — ${count(before.junk)}. ${reasonChanges.length ? `Наибольшие изменения: ${reasonChangeText}` : "Количество заявок по причинам не изменилось"}`;

  const services = [...new Set([...beforeRows, ...afterRows].map((row) => row.service || "Услуга не указана"))]
    .sort((a, b) => a.localeCompare(b, "ru"));
  const serviceStats = (items) => {
    const result = new Map();
    items.forEach((row) => {
      const service = row.service || "Услуга не указана";
      if (!result.has(service)) result.set(service, []);
      result.get(service).push(row);
    });
    return result;
  };
  const serviceBefore = serviceStats(beforeRows);
  const serviceAfter = serviceStats(afterRows);
  const leadingServices = [...serviceAfter.entries()].map(([name, items]) => ({ name, stats: countsFor(items) }))
    .filter((item) => item.stats.junk > 0)
    .sort((a, b) => b.stats.junk - a.stats.junk || a.name.localeCompare(b.name, "ru"))
    .slice(0, 2);
  const leadingServiceText = leadingServices.map((item) => `«${item.name}» — ${count(item.stats.junk)} из ${count(item.stats.classified)}`).join(", ");
  const leadingJunkCount = leadingServices.reduce((sum, item) => sum + item.stats.junk, 0);
  el("service-conclusion").textContent = !after.classified
    ? "На дату отчёта недостаточно классифицированных заявок для вывода по услугам"
    : !leadingServices.length
      ? "На дату отчёта нецелевые обращения по услугам в выгрузке не зафиксированы"
      : `На дату отчёта больше всего нецелевых заявок: ${leadingServiceText}. ${leadingServices.length > 1 ? "Вместе эти услуги дают" : "Эта услуга даёт"} ${count(leadingJunkCount)} из ${count(after.junk)} нецелевых заявок`;
  el("service-rows").innerHTML = services.length
    ? services.map((service) => {
      const old = countsFor(serviceBefore.get(service) || []);
      const recent = countsFor(serviceAfter.get(service) || []);
      const oldHasRows = (serviceBefore.get(service) || []).length > 0;
      const recentHasRows = (serviceAfter.get(service) || []).length > 0;
      return `<tr><th scope="row">${escapeHtml(service)}</th><td>${oldHasRows ? count(old.target) : "—"}</td><td>${oldHasRows ? count(old.junk) : "—"}</td><td>${oldHasRows ? pctText(old.junkRate) : "—"}</td><td>${recentHasRows ? count(recent.target) : "—"}</td><td>${recentHasRows ? count(recent.junk) : "—"}</td><td>${recentHasRows ? pctText(recent.junkRate) : "—"}</td></tr>`;
    }).join("")
    : '<tr><td colspan="7">Заявок Авито за эти периоды нет</td></tr>';
  el("service-total").innerHTML = `<tr><th scope="row">Все услуги Авито</th><td>${count(before.target)}</td><td>${count(before.junk)}</td><td>${pctText(before.junkRate)}</td><td>${count(after.target)}</td><td>${count(after.junk)}</td><td>${pctText(after.junkRate)}</td></tr>`;
  const unknown = before.unknown + after.unknown;
  el("service-note").textContent = unknown
    ? `«—» означает, что заявок по услуге в периоде не было. В расчёт доли входят только классифицированные заявки. Без классификации в этих периодах: ${count(unknown)}`
    : "«—» означает, что заявок по услуге в периоде не было. Доля нецелевых = нецелевые / (целевые + нецелевые)";
}

function showSectionProblem(section, problem) {
  const map = {
    network: ["error", "Нет связи с источником данных", "Проверьте подключение и повторите загрузку"],
    202: ["loading", "Данные ещё собираются", `Повторите загрузку через ${problem.retryAfter} сек`],
    403: ["error", "Нет доступа", "Проверьте права на просмотр данных клиента"],
    429: ["error", "Лимит запросов исчерпан", `Повторите загрузку через ${problem.retryAfter} сек`],
  };
  const [kind, title, body] = map[problem.status] || ["error", "Не удалось загрузить данные", "Повторите запрос или проверьте источник данных"];
  el(section).innerHTML = stateMarkup(kind, title, body);
}

async function loadReport() {
  const button = el("reload-button");
  button.disabled = true;
  ["channel-content", "junk-content", "service-content", "review-content", "reviews-insight", "junk-insight"].forEach((id) => { el(id).hidden = true; });
  ["reviews-status", "junk-status"].forEach((id) => {
    el(id).textContent = "Ожидаем данные";
    el(id).dataset.result = "unknown";
  });
  ["service-note", "data-period-note"].forEach((id) => { el(id).textContent = ""; });
  el("global-state").innerHTML = "";
  el("channel-state").innerHTML = stateMarkup("loading", "Загружаем обращения", "Собираем данные по каналам", false);
  el("avito-state").innerHTML = stateMarkup("loading", "Загружаем заявки Авито", "Собираем причины и услуги", false);
  el("history-state").innerHTML = stateMarkup("loading", "Загружаем снимки отзывов", "Сравниваем стартовый и последний снимок", false);
  el("service-state").innerHTML = "";
  try {
    const [clientResult, leadsResult, historyResult] = await Promise.allSettled([
      getJson("clients?manager=%D0%98%D1%80%D0%B8%D0%BD%D0%B0"),
      getJson(`leads?client_id=${encodeURIComponent(CLIENT_ID)}&limit=500`),
      getJson(`history/${encodeURIComponent(CLIENT_ID)}`),
    ]);
    const client = clientResult.status === "fulfilled"
      ? (clientResult.value.items || []).find((item) => item.client_id === CLIENT_ID)
      : null;
    if (clientResult.status === "rejected") {
      showSectionProblem("global-state", clientResult.reason);
      renderClient(null);
    }
    else if (!client) {
      showEmpty("global-state", "Карточка клиента не найдена", "Проверьте, доступна ли карточка клиента cl-01");
      renderClient(null);
    }
    else renderClient(client);

    if (leadsResult.status === "rejected") {
      showSectionProblem("channel-state", leadsResult.reason);
      showSectionProblem("avito-state", leadsResult.reason);
      showSectionProblem("service-state", leadsResult.reason);
      el("channel-content").hidden = true;
      el("junk-content").hidden = true;
      el("service-content").hidden = true;
    } else {
      el("channel-state").innerHTML = "";
      el("avito-state").innerHTML = "";
      el("service-state").innerHTML = "";
      const rows = Array.isArray(leadsResult.value.items) ? leadsResult.value.items.filter((item) => item.client_id === CLIENT_ID) : [];
      if (!rows.length) {
        showEmpty("channel-state", "Заявок пока нет", "Данные по каналам появятся после сбора обращений");
        el("channel-content").hidden = true;
        showEmpty("avito-state", "Заявок Авито пока нет", "Сравнение с целью станет доступно, когда появятся классифицированные обращения");
        el("junk-content").hidden = true;
        showEmpty("service-state", "Пока нет заявок для таблицы", "Таблица заполнится после получения данных из Авито");
        el("service-content").hidden = true;
      } else {
        el("channel-content").hidden = false;
        el("junk-content").hidden = false;
        el("service-content").hidden = false;
        const start = client?.service_started || historyResult.value?.before?.date;
        const windows = buildWindows(rows, start);
        if (!windows) {
          showEmpty("channel-state", "Не указана дата начала работ", "Добавьте дату начала работ в карточку клиента или стартовый снимок истории");
          showEmpty("avito-state", "Не указана дата начала работ", "Без этой даты нельзя сопоставить заявки с периодом действия обещания");
          showEmpty("service-state", "Не указана дата начала работ", "Без этой даты нельзя определить периоды сравнения");
          el("channel-content").hidden = true;
          el("junk-content").hidden = true;
          el("service-content").hidden = true;
        } else {
          renderChannelReport(rows, windows);
          renderAvitoLeads(rows, windows, client);
          el("avito-state").innerHTML = "";
          el("service-state").innerHTML = "";
          el("junk-content").hidden = false;
          el("service-content").hidden = false;
          el("data-period-note").textContent = windows.observedAfter
          ? `Последняя дата заявки в данных: ${humanDate(windows.observedAfter, true)} Сравниваются равные периоды по ${count(windows.duration)} дней`
            : "После начала работ заявок в данных пока нет; оценить цель по качеству обращений нельзя";
        }
      }
    }

    if (historyResult.status === "rejected") {
      showSectionProblem("history-state", historyResult.reason);
      el("reviews-status").textContent = historyResult.reason.status === 202 ? "Данные собираются" : "Данные недоступны";
    }
    else {
      el("history-state").innerHTML = "";
      renderHistory(historyResult.value, client?.service_started);
    }
    if (el("review-content").hidden && historyResult.status === "fulfilled") el("reviews-status").textContent = "Нет снимков";
    if (el("junk-content").hidden) el("junk-status").textContent = leadsResult.status === "rejected"
      ? (leadsResult.reason.status === 202 ? "Данные собираются" : "Данные недоступны")
      : "Нет данных для сравнения";

    const stale = DEMO_STATE === "stale" || [clientResult, leadsResult, historyResult].some((result) => result.status === "fulfilled" && result.value?.stale === true);
    if (stale) el("global-state").insertAdjacentHTML("afterbegin", stateMarkup("stale", "Показываем последний доступный срез", "Площадка не обновила данные. Перед обсуждением с клиентом сверьте дату снимка", false));
  } finally {
    button.disabled = false;
  }
}

document.addEventListener("click", (event) => {
  if (event.target.closest("[data-retry]")) loadReport();
});
el("reload-button").addEventListener("click", loadReport);
loadReport();
