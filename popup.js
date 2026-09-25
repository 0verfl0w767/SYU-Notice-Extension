const noticeList = document.getElementById("noticeList");
const loading = document.getElementById("loading");
const error = document.getElementById("error");
const refreshBtn = document.getElementById("refreshBtn");
const retryBtn = document.getElementById("retryBtn");
const notificationToggle = document.getElementById("notificationToggle");
const intervalSelect = document.getElementById("intervalSelect");
const hiddenBtn = document.getElementById("hiddenBtn");
const hiddenCount = document.getElementById("hiddenCount");
const hiddenModal = document.getElementById("hiddenModal");
const closeModal = document.getElementById("closeModal");
const hiddenList = document.getElementById("hiddenList");
const resetBtn = document.getElementById("resetBtn");
const noticeView = document.getElementById("noticeView");
const calendarView = document.getElementById("calendarView");
const calendarTitle = document.getElementById("calendarTitle");
const calendarGrid = document.getElementById("calendarGrid");
const calendarLoading = document.getElementById("calendarLoading");
const calendarError = document.getElementById("calendarError");
const calendarRetryBtn = document.getElementById("calendarRetryBtn");
const calendarDetails = document.getElementById("calendarDetails");
const prevMonthBtn = document.getElementById("prevMonthBtn");
const nextMonthBtn = document.getElementById("nextMonthBtn");

let currentNoticeType = "academic";
let currentView = "notices";
let calendarDate = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
let calendarEvents = [];
let calendarRequestId = 0;

document.addEventListener("DOMContentLoaded", async () => {
  await loadSettings();
  await loadNotices();
  await updateHiddenCount();

  refreshBtn.addEventListener("click", handleRefresh);
  retryBtn.addEventListener("click", handleRefresh);
  notificationToggle.addEventListener("change", handleNotificationToggle);
  intervalSelect.addEventListener("change", handleIntervalChange);
  hiddenBtn.addEventListener("click", openHiddenModal);
  closeModal.addEventListener("click", closeHiddenModal);
  resetBtn.addEventListener("click", handleReset);
  resetBtn.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handleReset();
    }
  });

  document.querySelectorAll(".view-tab").forEach((btn) => {
    btn.addEventListener("click", () => switchView(btn.dataset.view));
  });

  prevMonthBtn.addEventListener("click", () => changeCalendarMonth(-1));
  nextMonthBtn.addEventListener("click", () => changeCalendarMonth(1));
  calendarTitle.addEventListener("click", goToCurrentMonth);
  calendarRetryBtn.addEventListener("click", () => loadCalendar(true));

  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const type = e.target.getAttribute("data-type");
      switchTab(type);
    });
  });

  hiddenModal.addEventListener("click", (e) => {
    if (e.target === hiddenModal) {
      closeHiddenModal();
    }
  });
});

async function switchView(view) {
  if (view !== "notices" && view !== "calendar") return;

  currentView = view;
  const showCalendar = view === "calendar";
  noticeView.hidden = showCalendar;
  calendarView.hidden = !showCalendar;

  document.querySelectorAll(".view-tab").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.view === view);
  });

  if (showCalendar) {
    await loadCalendar();
  }
}

async function loadSettings() {
  const result = await chrome.storage.local.get([
    "notificationsEnabled",
    "checkIntervalMinutes",
  ]);
  notificationToggle.checked = result.notificationsEnabled !== false;
  intervalSelect.value = String(result.checkIntervalMinutes || 60);
  intervalSelect.disabled = result.notificationsEnabled === false;
}

async function handleNotificationToggle(e) {
  const enabled = e.target.checked;
  await chrome.storage.local.set({ notificationsEnabled: enabled });
  intervalSelect.disabled = !enabled;

  await chrome.runtime.sendMessage({
    type: "TOGGLE_NOTIFICATIONS",
    enabled,
  });
}

async function handleIntervalChange(e) {
  const minutes = Number(e.target.value);

  await chrome.storage.local.set({ checkIntervalMinutes: minutes });

  try {
    const response = await chrome.runtime.sendMessage({
      type: "UPDATE_CHECK_INTERVAL",
      minutes,
    });

    if (response && response.ok === false) {
      console.error("Failed to update interval:", response.error);
    }
  } catch (err) {
    console.error("Failed to update interval:", err?.message || err);
  }
}

async function loadNotices() {
  showLoading();

  try {
    const notices = await fetchNotices();
    displayNotices(notices);

    await chrome.storage.local.set({
      lastChecked: Date.now(),
      latestNotices: notices,
    });
  } catch (err) {
    showError();
    console.error("Error loading notices:", err);
  }
}

async function switchTab(noticeType) {
  currentNoticeType = noticeType;

  document.querySelectorAll(".tab-btn").forEach((btn) => {
    if (btn.getAttribute("data-type") === noticeType) {
      btn.classList.add("active");
    } else {
      btn.classList.remove("active");
    }
  });

  const footerLink = document.querySelector("footer a");
  if (footerLink) {
    if (noticeType === "scholarship") {
      footerLink.href =
        "https://www.syu.ac.kr/academic/scholarship-information/scholarship-notice/";
      footerLink.textContent = "전체 장학공지 보기 →";
    } else if (noticeType === "software") {
      footerLink.href = "https://www.syu.ac.kr/swuniv/community/notice/";
      footerLink.textContent = "전체 SW공지 보기 →";
    } else if (noticeType === "event") {
      footerLink.href = "https://www.syu.ac.kr/university-square/notice/event/";
      footerLink.textContent = "전체 행사공지 보기 →";
    } else {
      footerLink.href = "https://www.syu.ac.kr/academic/academic-notice/";
      footerLink.textContent = "전체 학사공지 보기 →";
    }
  }

  await loadNotices();
}

async function loadCalendar(forceRefresh = false) {
  const requestId = ++calendarRequestId;
  const academicYear = getAcademicYear(calendarDate);

  calendarTitle.textContent = `${calendarDate.getFullYear()}년 ${calendarDate.getMonth() + 1}월`;
  calendarLoading.hidden = false;
  calendarError.hidden = true;
  calendarGrid.hidden = true;
  calendarDetails.hidden = true;

  try {
    const result = await chrome.runtime.sendMessage({
      type: "GET_ACADEMIC_SCHEDULE",
      academicYear,
      forceRefresh,
    });

    if (requestId !== calendarRequestId) return;
    if (!result || !result.ok) {
      throw new Error(result?.error || "Failed to fetch academic schedule");
    }

    calendarEvents = (result.events || []).map((event, index) => ({
      ...event,
      id: `${event.start}-${event.end}-${index}`,
      type: classifySchedule(event.title),
    }));
    calendarView.classList.toggle("using-stale-cache", result.stale === true);
    renderCalendar();
  } catch (err) {
    if (requestId !== calendarRequestId) return;
    calendarLoading.hidden = true;
    calendarError.hidden = false;
    calendarGrid.hidden = true;
    console.error("Error loading academic schedule:", err);
  }
}

function getAcademicYear(date) {
  return date.getMonth() < 2 ? date.getFullYear() - 1 : date.getFullYear();
}

function changeCalendarMonth(offset) {
  calendarDate = new Date(
    calendarDate.getFullYear(),
    calendarDate.getMonth() + offset,
    1,
  );
  loadCalendar();
}

function goToCurrentMonth() {
  const today = new Date();
  calendarDate = new Date(today.getFullYear(), today.getMonth(), 1);
  loadCalendar();
}

function renderCalendar() {
  const year = calendarDate.getFullYear();
  const month = calendarDate.getMonth();
  const monthStart = new Date(year, month, 1);
  const monthEnd = new Date(year, month + 1, 0);
  const gridStart = addDays(monthStart, -monthStart.getDay());
  const gridEnd = addDays(monthEnd, 6 - monthEnd.getDay());
  const weeks = [];

  for (let start = gridStart; start <= gridEnd; start = addDays(start, 7)) {
    weeks.push(new Date(start));
  }

  calendarTitle.textContent = `${year}년 ${month + 1}월`;
  calendarGrid.innerHTML = weeks
    .map((weekStart) => renderCalendarWeek(weekStart, month))
    .join("");

  calendarLoading.hidden = true;
  calendarError.hidden = true;
  calendarGrid.hidden = false;
  bindCalendarInteractions();
}

function renderCalendarWeek(weekStart, currentMonth) {
  const weekEnd = addDays(weekStart, 6);
  const segments = buildWeekSegments(weekStart, weekEnd);
  const laneCount = segments.reduce(
    (max, segment) => Math.max(max, segment.lane + 1),
    0,
  );
  const compactEvents = laneCount >= 4;
  const eventHeight = compactEvents ? 10 : 14;
  const eventStep = compactEvents ? 11 : 15;
  const days = [];

  for (let index = 0; index < 7; index += 1) {
    const date = addDays(weekStart, index);
    const dateKey = toIsoDate(date);
    const classes = ["calendar-day"];
    if (date.getMonth() !== currentMonth) classes.push("outside-month");
    if (isToday(date)) classes.push("today");
    if (index === 0) classes.push("sunday");
    if (index === 6) classes.push("saturday");

    days.push(`
      <button class="${classes.join(" ")}" data-date="${dateKey}" aria-label="${formatAccessibleDate(date)}">
        <span class="day-number">${date.getDate()}</span>
      </button>
    `);
  }

  const eventBars = segments
    .map((segment) => {
      const continuationClasses = ["calendar-event", segment.event.type];
      if (segment.continuesLeft) continuationClasses.push("continues-left");
      if (segment.continuesRight) continuationClasses.push("continues-right");

      return `
        <button
          class="${continuationClasses.join(" ")}"
          data-event-id="${escapeHtml(segment.event.id)}"
          style="left:calc(${(segment.startIndex / 7) * 100}% + 2px);width:calc(${(segment.span / 7) * 100}% - 4px);top:${24 + segment.lane * eventStep}px;height:${eventHeight}px;line-height:${eventHeight - 2}px;font-size:${compactEvents ? 7 : 8}px"
          title="${escapeHtml(segment.event.title)}"
        >${escapeHtml(segment.event.title)}</button>
      `;
    })
    .join("");

  return `
    <div class="calendar-week">
      ${days.join("")}
      ${eventBars}
    </div>
  `;
}

function buildWeekSegments(weekStart, weekEnd) {
  const candidates = calendarEvents
    .map((event) => ({
      event,
      start: parseIsoDate(event.start),
      end: parseIsoDate(event.end),
    }))
    .filter(({ start, end }) => start <= weekEnd && end >= weekStart)
    .map(({ event, start, end }) => {
      const clippedStart = start < weekStart ? weekStart : start;
      const clippedEnd = end > weekEnd ? weekEnd : end;
      const startIndex = daysBetween(weekStart, clippedStart);
      const endIndex = daysBetween(weekStart, clippedEnd);

      return {
        event,
        startIndex,
        endIndex,
        span: endIndex - startIndex + 1,
        continuesLeft: start < weekStart,
        continuesRight: end > weekEnd,
      };
    })
    .sort(
      (a, b) =>
        a.startIndex - b.startIndex ||
        b.span - a.span ||
        a.event.title.localeCompare(b.event.title, "ko"),
    );

  const laneEnds = [];
  return candidates.map((segment) => {
    let lane = laneEnds.findIndex((endIndex) => endIndex < segment.startIndex);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = segment.endIndex;
    return { ...segment, lane };
  });
}

function bindCalendarInteractions() {
  calendarGrid.querySelectorAll(".calendar-event").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      const selected = calendarEvents.find(
        (item) => item.id === button.dataset.eventId,
      );
      if (selected) showCalendarDetails([selected]);
    });
  });

  calendarGrid.querySelectorAll(".calendar-day").forEach((button) => {
    button.addEventListener("click", () => {
      const date = button.dataset.date;
      const events = calendarEvents.filter(
        (event) => event.start <= date && event.end >= date,
      );
      showCalendarDetails(events, date);
    });
  });
}

function showCalendarDetails(events, date = "") {
  if (events.length === 0) {
    calendarDetails.hidden = true;
    return;
  }

  const heading = date ? formatKoreanDate(parseIsoDate(date)) : "일정 상세";
  calendarDetails.innerHTML = `
    <div class="calendar-details-header">
      <strong>${escapeHtml(heading)}</strong>
      <button class="calendar-details-close" aria-label="상세 닫기">×</button>
    </div>
    ${events
      .map(
        (event) => `
          <div class="calendar-detail-item">
            <i class="legend-dot ${event.type}"></i>
            <div>
              <strong>${escapeHtml(event.title)}</strong>
              <span>${escapeHtml(formatEventDateRange(event))}</span>
            </div>
          </div>
        `,
      )
      .join("")}
  `;
  calendarDetails.hidden = false;
  calendarDetails
    .querySelector(".calendar-details-close")
    .addEventListener("click", () => {
      calendarDetails.hidden = true;
    });
  calendarDetails.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

function classifySchedule(title) {
  if (
    /(삼일절|광복절|추석|설날|한글날|개천절|성탄절|신정|어린이날|현충일|대체휴일|부처님|근로자의 날|지방선거|개교기념일)/.test(
      title,
    )
  ) {
    return "holiday";
  }
  if (/(고사|시험|성적|졸업사정|학위수여)/.test(title)) return "exam";
  if (/(수강|등록|휴[·ㆍ]?복학|교직과정|신청|접수)/.test(title)) {
    return "registration";
  }
  if (/(축제|세미나|CAMP|체육대회|협의회|입학식)/i.test(title)) {
    return "event";
  }
  return "academic";
}

function formatEventDateRange(event) {
  const start = formatKoreanDate(parseIsoDate(event.start));
  if (event.start === event.end) return start;
  return `${start} ~ ${formatKoreanDate(parseIsoDate(event.end))}`;
}

function formatKoreanDate(date) {
  return `${date.getFullYear()}년 ${date.getMonth() + 1}월 ${date.getDate()}일`;
}

function formatAccessibleDate(date) {
  const weekdays = ["일", "월", "화", "수", "목", "금", "토"];
  return `${formatKoreanDate(date)} ${weekdays[date.getDay()]}요일`;
}

function parseIsoDate(value) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function toIsoDate(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function addDays(date, amount) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + amount);
}

function daysBetween(start, end) {
  const dayMs = 24 * 60 * 60 * 1000;
  const utcStart = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate());
  const utcEnd = Date.UTC(end.getFullYear(), end.getMonth(), end.getDate());
  return Math.round((utcEnd - utcStart) / dayMs);
}

function isToday(date) {
  const today = new Date();
  return (
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate()
  );
}

async function fetchNotices() {
  const result = await chrome.runtime.sendMessage({
    type: "GET_NOTICES",
    noticeType: currentNoticeType,
  });

  if (!result || !result.ok) {
    throw new Error(result?.error || "Failed to fetch notices");
  }

  return result.notices || [];
}

async function displayNotices(notices) {
  hideLoading();
  hideError();

  if (notices.length === 0) {
    noticeList.innerHTML = `
      <div style="padding: 40px 20px; text-align: center; color: #6c757d;">
        <p>공지사항이 없습니다.</p>
      </div>
    `;
    return;
  }

  const storage = await chrome.storage.local.get([
    "readNotices",
    "hiddenNotices",
  ]);
  const readNotices = new Set(storage.readNotices || []);
  const hiddenNotices = new Set(storage.hiddenNotices || []);

  const visibleNotices = notices.filter((n) => !hiddenNotices.has(n.link));

  const pinnedNotices = visibleNotices.filter((n) => n.isNotice);
  const regularNotices = visibleNotices.filter((n) => !n.isNotice);

  const fewDaysAgo = Date.now() - 72 * 60 * 60 * 1000;

  let html = "";

  if (pinnedNotices.length > 0) {
    html += '<div class="pinned-section">';
    html += pinnedNotices
      .map((notice) => {
        const noticeTime = parseNoticeDate(notice.date);
        const showAsNew = Boolean(noticeTime && noticeTime > fewDaysAgo);
        const isRead = readNotices.has(notice.link);

        return `
          <div class="notice-item pinned ${showAsNew ? "new" : ""} ${isRead ? "read" : ""}" data-link="${escapeHtml(notice.link)}">
            <div class="notice-content">
              <div class="notice-title">
                <img src="icons/pin.png" alt="고정" style="width:16px;height:16px;vertical-align:middle;margin-right:4px;position:relative;top:-3px;">${escapeHtml(notice.title)}
              </div>
              <div class="notice-meta">
                <span class="notice-date">
                  ${escapeHtml(notice.date)}${notice.department ? " · " + escapeHtml(notice.department) : ""}
                </span>
                <div class="notice-badges">
                  <span class="badge badge-pinned">고정</span>
                  ${showAsNew ? '<span class="badge" style="background: #28a745;">NEW</span>' : ""}
                  ${isRead ? '<span class="badge" style="background: #6c757d;">읽음</span>' : ""}
                </div>
              </div>
            </div>
            <button class="hide-btn" data-link="${escapeHtml(notice.link)}" title="숨기기"><img src="icons/hide.png" alt="숨기기" style="width:16px;height:16px;vertical-align:middle;"></button>
          </div>
        `;
      })
      .join("");
    html += "</div>";
  }

  if (regularNotices.length > 0) {
    html += '<div class="regular-section">';
    html += regularNotices
      .map((notice) => {
        const noticeTime = parseNoticeDate(notice.date);
        const showAsNew = Boolean(noticeTime && noticeTime > fewDaysAgo);
        const isRead = readNotices.has(notice.link);

        return `
          <div class="notice-item ${showAsNew ? "new" : ""} ${isRead ? "read" : ""}" data-link="${escapeHtml(notice.link)}">
            <div class="notice-content">
              <div class="notice-title">${escapeHtml(notice.title)}</div>
              <div class="notice-meta">
                <span class="notice-date">
                  ${escapeHtml(notice.date)}${notice.department ? " · " + escapeHtml(notice.department) : ""}
                </span>
                <div class="notice-badges">
                  ${showAsNew ? '<span class="badge" style="background: #28a745;">NEW</span>' : ""}
                  ${isRead ? '<span class="badge" style="background: #6c757d;">읽음</span>' : ""}
                </div>
              </div>
            </div>
            <button class="hide-btn" data-link="${escapeHtml(notice.link)}" title="숨기기"><img src="icons/hide.png" alt="숨기기" style="width:16px;height:16px;vertical-align:middle;"></button>
          </div>
        `;
      })
      .join("");
    html += "</div>";
  }

  noticeList.innerHTML = html;

  document.querySelectorAll(".notice-item").forEach((item) => {
    item.addEventListener("click", async (e) => {
      if (
        e.target.classList.contains("hide-btn") ||
        e.target.closest(".hide-btn")
      ) {
        return;
      }

      const link = item.getAttribute("data-link");

      await markAsRead(link);
      item.classList.add("read");

      const badgesContainer = item.querySelector(".notice-badges");
      if (badgesContainer && !item.querySelector('.badge[style*="6c757d"]')) {
        badgesContainer.innerHTML +=
          '<span class="badge" style="background: #6c757d;">읽음</span>';
      }

      chrome.tabs.create({ url: link });
    });
  });

  document.querySelectorAll(".hide-btn").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const link = btn.getAttribute("data-link");

      const notice = notices.find((n) => n.link === link);
      if (notice) {
        await hideNotice(notice);
      }

      btn.closest(".notice-item").remove();
      await updateHiddenCount();
    });
  });
}

async function handleRefresh() {
  refreshBtn.style.transform = "rotate(360deg)";
  setTimeout(() => {
    refreshBtn.style.transform = "";
  }, 300);

  if (currentView === "calendar") {
    await loadCalendar(true);
  } else {
    await loadNotices();
  }
}

async function handleReset() {
  if (confirm("읽은 공지와 숨긴 공지를 모두 초기화하시겠어요?")) {
    await chrome.storage.local.remove([
      "readNotices",
      "hiddenNotices",
      "hiddenNoticesData",
    ]);

    await loadNotices();
    await updateHiddenCount();

    showResetNotification();
  }
}

function showResetNotification() {
  const notification = document.createElement("div");
  notification.className = "reset-notification";
  notification.textContent = "데이터가 초기화되었어요!";
  document.body.appendChild(notification);

  setTimeout(() => {
    notification.classList.add("show");
  }, 10);

  setTimeout(() => {
    notification.classList.remove("show");
    setTimeout(() => {
      notification.remove();
    }, 300);
  }, 2000);
}

async function markAsRead(link) {
  const storage = await chrome.storage.local.get(["readNotices"]);
  const readNotices = storage.readNotices || [];

  if (!readNotices.includes(link)) {
    readNotices.push(link);
    await chrome.storage.local.set({ readNotices });
  }
}

async function hideNotice(notice) {
  const storage = await chrome.storage.local.get([
    "hiddenNotices",
    "hiddenNoticesData",
  ]);
  const hiddenNotices = storage.hiddenNotices || [];
  const hiddenNoticesData = storage.hiddenNoticesData || {};

  if (!hiddenNotices.includes(notice.link)) {
    hiddenNotices.push(notice.link);
    hiddenNoticesData[notice.link] = notice;
    await chrome.storage.local.set({ hiddenNotices, hiddenNoticesData });
  }
}

async function restoreNotice(link) {
  const storage = await chrome.storage.local.get([
    "hiddenNotices",
    "hiddenNoticesData",
  ]);
  let hiddenNotices = storage.hiddenNotices || [];
  let hiddenNoticesData = storage.hiddenNoticesData || {};

  hiddenNotices = hiddenNotices.filter((l) => l !== link);
  delete hiddenNoticesData[link];
  await chrome.storage.local.set({ hiddenNotices, hiddenNoticesData });
}

async function updateHiddenCount() {
  const storage = await chrome.storage.local.get(["hiddenNotices"]);
  const count = (storage.hiddenNotices || []).length;

  hiddenCount.textContent = count;

  if (count > 0) {
    hiddenCount.classList.add("show");
  } else {
    hiddenCount.classList.remove("show");
  }
}

async function openHiddenModal() {
  const storage = await chrome.storage.local.get([
    "hiddenNotices",
    "hiddenNoticesData",
  ]);
  const hiddenNotices = storage.hiddenNotices || [];
  const hiddenNoticesData = storage.hiddenNoticesData || {};

  const hiddenItems = hiddenNotices
    .map((link) => hiddenNoticesData[link])
    .filter((notice) => notice !== undefined);

  if (hiddenItems.length === 0) {
    hiddenList.innerHTML = "";
  } else {
    hiddenList.innerHTML = hiddenItems
      .map(
        (notice) => `
      <div class="hidden-item" data-link="${escapeHtml(notice.link)}">
        <div class="hidden-item-content">
          <div class="hidden-item-title">${escapeHtml(notice.title)}</div>
          <div class="hidden-item-date">${escapeHtml(notice.date)}${notice.department ? " · " + escapeHtml(notice.department) : ""}</div>
        </div>
        <button class="restore-btn" data-link="${escapeHtml(notice.link)}">복원</button>
      </div>
    `,
      )
      .join("");

    document.querySelectorAll(".restore-btn").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const link = btn.getAttribute("data-link");

        await restoreNotice(link);
        await updateHiddenCount();
        await loadNotices();

        btn.closest(".hidden-item").remove();

        if (hiddenList.children.length === 0) {
          closeHiddenModal();
        }
      });
    });
  }

  hiddenModal.style.display = "flex";
}

function closeHiddenModal() {
  hiddenModal.style.display = "none";
}

function parseNoticeDate(dateStr) {
  if (!dateStr) return null;

  const match = dateStr.match(/(\d{4})[-.](\d{2})[-.](\d{2})/);
  if (match) {
    const [_, year, month, day] = match;
    return new Date(year, month - 1, day).getTime();
  }

  return null;
}

function showLoading() {
  loading.style.display = "flex";
  noticeList.style.display = "block";
  noticeList.style.visibility = "hidden";
  error.style.display = "none";
}

function hideLoading() {
  loading.style.display = "none";
  noticeList.style.display = "block";
  noticeList.style.visibility = "visible";
}

function showError() {
  loading.style.display = "none";
  error.style.display = "block";
  noticeList.style.display = "block";
  noticeList.style.visibility = "hidden";
}

function hideError() {
  error.style.display = "none";
  noticeList.style.visibility = "visible";
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = decodeHtmlEntities(String(text ?? ""));
  return div.innerHTML;
}

function decodeHtmlEntities(text) {
  if (typeof text !== "string" || !text.includes("&")) {
    return text || "";
  }

  const textarea = document.createElement("textarea");
  textarea.innerHTML = text;
  return textarea.value;
}
