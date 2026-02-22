const CHECK_INTERVAL = 30;
const NOTICE_URLS = {
  academic: "https://notice.syu.kr/notices/academic",
  event: "https://notice.syu.kr/notices/event",
  scholarship: "https://notice.syu.kr/notices/scholarship",
};

chrome.runtime.onInstalled.addListener(() => {
  console.log("SYU Notice Extension installed");

  chrome.storage.local.set({
    notificationsEnabled: true,
    lastChecked: 0,
  });

  chrome.alarms.create("checkNotices", {
    periodInMinutes: CHECK_INTERVAL,
  });

  checkNewNotices();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "checkNotices") {
    checkNewNotices();
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "TOGGLE_NOTIFICATIONS") {
    handleNotificationToggle(message.enabled);
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
  if (enabled) {
    chrome.alarms.create("checkNotices", {
      periodInMinutes: CHECK_INTERVAL,
    });
    checkNewNotices();
  } else {
    chrome.alarms.clear("checkNotices");
  }
}

async function checkNewNotices() {
  try {
    const settings = await chrome.storage.local.get([
      "notificationsEnabled",
      "latestNotices",
    ]);

    if (settings.notificationsEnabled === false) {
      return;
    }

    const notices = await fetchNotices();

    if (!notices || notices.length === 0) {
      return;
    }

    const previousNotices = settings.latestNotices || [];
    const newNotices = findNewNotices(notices, previousNotices);

    if (newNotices.length > 0) {
      showNotifications(newNotices);
    }

    await chrome.storage.local.set({
      latestNotices: notices.slice(0, 10),
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

      let title = titleMatch[1].trim();

      const categoryMatch = row.match(/<span class="md_cate">([^<]+)<\/span>/i);
      if (categoryMatch) {
        const category = categoryMatch[1].trim();
        title = `[${category}] ${title}`;
      }

      const linkMatch = row.match(/<a href="([^"]+)" class="itembx"/i);
      if (!linkMatch) continue;

      const link = linkMatch[1].replace(/&amp;/g, "&");

      const dateMatch = row.match(/<td class="step4">([^<]+)<\/td>/i);
      const date = dateMatch ? dateMatch[1].trim() : "";

      const deptMatch = row.match(/<td class="step3">([^<]+)<\/td>/i);
      const department = deptMatch ? deptMatch[1].trim() : "";

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

function findNewNotices(currentNotices, previousNotices) {
  if (previousNotices.length === 0) {
    return [];
  }

  const previousTitles = new Set(previousNotices.map((n) => n.title));
  return currentNotices.filter((notice) => !previousTitles.has(notice.title));
}

function showNotifications(newNotices) {
  const maxNotifications = 3;
  const noticeToShow = newNotices.slice(0, maxNotifications);

  noticeToShow.forEach((notice, index) => {
    setTimeout(() => {
      chrome.notifications.create(
        {
          type: "basic",
          iconUrl: "icons/icon128.png",
          title: "새 학사공지",
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
        title: "새 학사공지",
        message: `외 ${newNotices.length - maxNotifications}개의 새 공지가 있습니다.`,
        priority: 1,
      });
    }, maxNotifications * 500);
  }
}
