const DEFAULT_CHECK_INTERVAL = 60;
const NOTICE_URLS = {
  academic: "https://notice.syu.kr/notices/academic",
  event: "https://notice.syu.kr/notices/event",
  scholarship: "https://notice.syu.kr/notices/scholarship",
  software: "https://notice.syu.kr/notices/software",
};
const NOTICE_TYPES = Object.keys(NOTICE_URLS);
const NOTICE_TYPE_LABELS = {
  academic: "학사공지",
  event: "행사공지",
  scholarship: "장학공지",
  software: "SW공지",
};
const HTML_ENTITY_MAP = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

chrome.runtime.onInstalled.addListener(() => {
  console.log("SYU Notice Extension installed");

  chrome.storage.local.get(
    ["notificationsEnabled", "lastChecked", "checkIntervalMinutes"],
    (stored) => {
      chrome.storage.local.set({
        notificationsEnabled: stored.notificationsEnabled !== false,
        lastChecked: stored.lastChecked || 0,
        checkIntervalMinutes:
          stored.checkIntervalMinutes || DEFAULT_CHECK_INTERVAL,
      });

      createNoticeAlarm(
        stored.checkIntervalMinutes || DEFAULT_CHECK_INTERVAL,
      ).then(() => {
        checkNewNotices();
      });
    },
  );
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "checkNotices") {
    checkNewNotices();
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "TOGGLE_NOTIFICATIONS") {
    handleNotificationToggle(message.enabled);
    sendResponse({ ok: true });
    return false;
  }

  if (message.type === "UPDATE_CHECK_INTERVAL") {
    (async () => {
      try {
        await updateCheckInterval(message.minutes);
        sendResponse({ ok: true });
      } catch (err) {
        sendResponse({
          ok: false,
          error: err?.message || "Failed to update interval",
        });
      }
    })();
    return true;
  }

  if (message.type === "GET_NOTICES") {
    const noticeType = message.noticeType || "academic";
    fetchNotices(noticeType)
      .then((notices) => sendResponse({ ok: true, notices }))
      .catch((err) =>
        sendResponse({ ok: false, error: err?.message || "Fetch failed" }),
      );
    return true;
  }
});

async function handleNotificationToggle(enabled) {
  const { checkIntervalMinutes } = await chrome.storage.local.get([
    "checkIntervalMinutes",
  ]);
  const interval = checkIntervalMinutes || DEFAULT_CHECK_INTERVAL;

  if (enabled) {
    await createNoticeAlarm(interval);
    checkNewNotices();
  } else {
    chrome.alarms.clear("checkNotices");
  }
}

async function updateCheckInterval(minutes) {
  const interval = Number(minutes);

  if (!Number.isFinite(interval) || interval < 1) {
    throw new Error("Invalid interval");
  }

  await chrome.storage.local.set({ checkIntervalMinutes: interval });

  const { notificationsEnabled } = await chrome.storage.local.get([
    "notificationsEnabled",
  ]);

  if (notificationsEnabled !== false) {
    await createNoticeAlarm(interval);
  }
}

async function createNoticeAlarm(minutes) {
  await chrome.alarms.clear("checkNotices");
  chrome.alarms.create("checkNotices", {
    periodInMinutes: minutes,
  });
}

async function checkNewNotices() {
  try {
    const settings = await chrome.storage.local.get([
      "notificationsEnabled",
      "latestNotices",
      "latestNoticesByType",
      "hiddenNotices",
    ]);

    if (settings.notificationsEnabled === false) {
      return;
    }

    const previousNoticesByType = settings.latestNoticesByType || {};
    const latestNoticesByType = { ...previousNoticesByType };
    const hiddenNotices = new Set(settings.hiddenNotices || []);

    for (const noticeType of NOTICE_TYPES) {
      try {
        const notices = await fetchNotices(noticeType);
        if (!notices || notices.length === 0) {
          continue;
        }

        const previousNotices =
          previousNoticesByType[noticeType] ||
          (noticeType === "academic" ? settings.latestNotices || [] : []);
        const newNotices = findNewNotices(
          notices,
          previousNotices,
          hiddenNotices,
        );

        if (newNotices.length > 0) {
          showNotifications(newNotices, noticeType);
        }

        latestNoticesByType[noticeType] = notices.slice(0, 10);
      } catch (err) {
        console.error(`Error checking ${noticeType} notices:`, err);
      }
    }

    await chrome.storage.local.set({
      latestNoticesByType,
      latestNotices:
        latestNoticesByType.academic || settings.latestNotices || [],
      lastChecked: Date.now(),
    });
  } catch (err) {
    console.error("Error checking new notices:", err);
  }
}

async function fetchNotices(noticeType = "academic") {
  const url = NOTICE_URLS[noticeType];
  if (!url) {
    throw new Error(`Invalid notice type: ${noticeType}`);
  }

  const response = await fetch(url);
  let html = "";

  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const data = await response.json();
    html = data.html || "";
  } else {
    html = await response.text();
  }

  if (!html) {
    return [];
  }

  const notices = [];

  const tbodyMatch = html.match(/<tbody>([\s\S]*?)<\/tbody>/i);
  if (!tbodyMatch) return notices;

  const tbody = tbodyMatch[1];

  const trRegex = /<tr>([\s\S]*?)<\/tr>/gi;
  const rows = tbody.match(trRegex) || [];

  for (const row of rows) {
    try {
      const hasNoticeIcon = row.includes("notice_icon");

      const titleMatch = row.match(/<span class="tit">([^<]+)<\/span>/i);
      if (!titleMatch) continue;

      let title = decodeHtmlEntities(titleMatch[1].trim());

      const categoryMatch = row.match(/<span class="md_cate">([^<]+)<\/span>/i);
      if (categoryMatch) {
        const category = decodeHtmlEntities(categoryMatch[1].trim());
        title = `[${category}] ${title}`;
      }

      const linkMatch = row.match(/<a href="([^"]+)" class="itembx"/i);
      if (!linkMatch) continue;

      const link = decodeHtmlEntities(linkMatch[1].trim());

      const dateMatch = row.match(/<td class="step4">([^<]+)<\/td>/i);
      const date = dateMatch ? decodeHtmlEntities(dateMatch[1].trim()) : "";

      const deptMatch = row.match(/<td class="step3">([^<]+)<\/td>/i);
      const department = deptMatch
        ? decodeHtmlEntities(deptMatch[1].trim())
        : "";

      const isNew = row.includes("md_new");

      if (title && link) {
        notices.push({
          title,
          link,
          date,
          department,
          isNotice: hasNoticeIcon,
          isNew,
          number: hasNoticeIcon ? "공지" : "",
        });
      }
    } catch (err) {
      console.error("Error parsing notice:", err);
    }
  }

  return notices;
}

function decodeHtmlEntities(text) {
  if (typeof text !== "string" || !text.includes("&")) {
    return text || "";
  }

  return text
    .replace(/&#(\d+);/g, (match, dec) => decodeCodePoint(dec, 10, match))
    .replace(/&#x([0-9a-f]+);/gi, (match, hex) =>
      decodeCodePoint(hex, 16, match),
    )
    .replace(
      /&([a-z]+);/gi,
      (match, name) => HTML_ENTITY_MAP[name.toLowerCase()] || match,
    );
}

function decodeCodePoint(value, radix, fallback) {
  const codePoint = Number.parseInt(value, radix);

  if (!Number.isInteger(codePoint)) {
    return fallback;
  }

  try {
    return String.fromCodePoint(codePoint);
  } catch {
    return fallback;
  }
}

function findNewNotices(currentNotices, previousNotices, hiddenNotices) {
  if (previousNotices.length === 0) {
    return [];
  }

  const previousLinks = new Set(previousNotices.map((notice) => notice.link));

  return currentNotices.filter((notice) => {
    if (hiddenNotices.has(notice.link) || !isWithinDays(notice.date, 3)) {
      return false;
    }

    return !previousLinks.has(notice.link);
  });
}

function parseNoticeDate(dateText) {
  if (!dateText || typeof dateText !== "string") {
    return null;
  }

  const normalized = dateText.trim().replace(/[^0-9]/g, "-");
  const parts = normalized
    .split("-")
    .filter(Boolean)
    .map((part) => Number(part));

  if (parts.length < 3 || parts.some((num) => Number.isNaN(num))) {
    return null;
  }

  let [year, month, day] = parts;
  if (year < 100) {
    year += 2000;
  }

  const parsed = new Date(year, month - 1, day);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed;
}

function isWithinDays(dateText, days) {
  const noticeDate = parseNoticeDate(dateText);
  if (!noticeDate) {
    return false;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  noticeDate.setHours(0, 0, 0, 0);

  const diffDays = Math.floor((today - noticeDate) / (1000 * 60 * 60 * 24));
  return diffDays >= 0 && diffDays <= days;
}

function showNotifications(newNotices, noticeType = "academic") {
  const maxNotifications = 3;
  const noticeToShow = newNotices.slice(0, maxNotifications);
  const noticeTypeLabel = NOTICE_TYPE_LABELS[noticeType] || "공지";

  noticeToShow.forEach((notice, index) => {
    setTimeout(() => {
      chrome.notifications.create(
        {
          type: "basic",
          iconUrl: "icons/icon128.png",
          title: `새 ${noticeTypeLabel}`,
          message: notice.title,
          priority: 2,
          requireInteraction: false,
        },
        (notificationId) => {
          chrome.notifications.onClicked.addListener((clickedId) => {
            if (clickedId === notificationId) {
              chrome.tabs.create({ url: notice.link });
            }
          });
        },
      );
    }, index * 500);
  });

  if (newNotices.length > maxNotifications) {
    setTimeout(() => {
      chrome.notifications.create({
        type: "basic",
        iconUrl: "icons/icon128.png",
        title: `새 ${noticeTypeLabel}`,
        message: `외 ${newNotices.length - maxNotifications}개의 새 공지가 있습니다.`,
        priority: 1,
      });
    }, maxNotifications * 500);
  }
}
