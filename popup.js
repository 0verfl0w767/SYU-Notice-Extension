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

let currentNoticeType = "academic";

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

  await loadNotices();
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
  div.textContent = text;
  return div.innerHTML;
}
