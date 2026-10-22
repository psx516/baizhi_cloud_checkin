/**
 * 百智云 (baizhi.cloud) 自动签到脚本
 * - Playwright headless Chromium 完成 WASM captcha
 * - 签到结束后通过 MeoW Push API 推送签到结果
 *
 * Secrets 需要配置:
 *   COOKIE_STRING / COOKIE_JSON  — 百智云登录 Cookie (二选一)
 *   MEOW_USERID                  — MeoW 推送昵称 (可选，不配则跳过推送)
 */

const { chromium } = require("playwright");

// ---------- MeoW 推送 ----------

/**
 * 通过 MeoW Push API 推送签到结果
 * 使用 POST JSON 避免中文 URL 编码问题；失败不影响主流程
 */
async function notifyMeow(result) {
  const userId = process.env.MEOW_USERID || "";
  if (!userId) {
    console.log("📡 未设置 MEOW_USERID，跳过 MeoW 推送");
    return;
  }

  const title = "百智云 · 每日签到";

  let statusIcon, statusText;
  if (result.success) {
    statusIcon = "🎉";
    statusText = "签到成功";
  } else if (result.alreadyChecked) {
    statusIcon = "📌";
    statusText = "今日已签到";
  } else if (result.cookieExpired) {
    statusIcon = "⚠️";
    statusText = "Cookie 已过期";
  } else {
    statusIcon = "❌";
    statusText = "签到失败";
  }

  const balanceLine =
    result.balanceBefore && result.balanceAfter
      ? `${result.balanceBefore.trim()} → ${result.balanceAfter.trim()}`
      : (result.balanceAfter || result.balanceBefore || "—").trim();

  const timeStr = new Date().toLocaleString("zh-CN");

  const msg = [
    `${statusIcon} ${statusText}`,
    `💰 积分: ${balanceLine}`,
    `⏰ ${timeStr}`,
  ].join("\n");

  const url = `https://api.chuckfang.com/${encodeURIComponent(userId)}`;

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, msg }),
      signal: AbortSignal.timeout(8000),
    });
    const body = await resp.json().catch(() => ({}));
    if (body.status === 200) {
      console.log(`📡 MeoW 推送成功 (to ${userId})`);
    } else {
      console.warn(
        `📡 MeoW 返回异常: status=${body.status}, msg=${body.msg || ""}`
      );
    }
  } catch (e) {
    console.warn(`📡 MeoW 推送异常 (忽略): ${e.message}`);
  }
}

// ---------- Cookie 解析 ----------

function parseCookies() {
  const cookieString = process.env.COOKIE_STRING || "";
  const cookieJson = process.env.COOKIE_JSON || "";
  const cookieDomain = process.env.COOKIE_DOMAIN || "baizhi.cloud";

  if (!cookieString && !cookieJson) {
    throw new Error("未设置 COOKIE_STRING 或 COOKIE_JSON 环境变量");
  }

  if (cookieJson) {
    const parsed = JSON.parse(cookieJson);
    return parsed.map((c) => ({
      name: c.name,
      value: c.value,
      domain: c.domain || `.${cookieDomain}`,
      path: c.path || "/",
      httpOnly: c.httpOnly || false,
      secure: c.secure || false,
      sameSite: c.sameSite || "Lax",
    }));
  }

  return cookieString.split(";").map((pair) => {
    const [name, ...rest] = pair.trim().split("=");
    return {
      name: name.trim(),
      value: rest.join("=").trim(),
      domain: `.${cookieDomain}`,
      path: "/",
      httpOnly: false,
      secure: true,
      sameSite: "Lax",
    };
  });
}

// ---------- 主流程 ----------

async function checkinCore() {
  const result = {
    success: false,
    alreadyChecked: false,
    cookieExpired: false,
    balanceBefore: "",
    balanceAfter: "",
    errorMessage: "",
  };

  let browser;
  let exitCode = 1;

  try {
    const cookies = parseCookies();
    console.log(`🔑 加载了 ${cookies.length} 个 cookie`);

    browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      viewport: { width: 1280, height: 800 },
    });

    await context.addCookies(cookies);
    const page = await context.newPage();

    page.on("console", (msg) => {
      if (msg.type() === "error") {
        console.log(`   [浏览器错误] ${msg.text().slice(0, 200)}`);
      }
    });

    console.log("🌐 正在访问百智云控制台...");
    await page.goto("https://baizhi.cloud/console/apps", {
      waitUntil: "networkidle",
      timeout: 30000,
    });

    // Cookie 失效判断
    const url = page.url();
    if (url.includes("/sign-in") || url.includes("/login")) {
      result.cookieExpired = true;
      result.errorMessage = "Cookie 已失效，被重定向到登录页";
      console.error(`❌ ${result.errorMessage}。请重新登录并更新 Cookie。`);
      exitCode = 2;
      return { result, exitCode };
    }

    console.log("✅ 登录状态验证通过");
    await page.waitForTimeout(2000);

    // 签到前积分
    try {
      const balanceEl = page.locator("text=/\\d+\\s*积分/").first();
      result.balanceBefore = (await balanceEl.textContent()) || "";
      console.log(`💰 签到前积分: ${result.balanceBefore.trim()}`);
    } catch {
      console.log("⚠️  未能获取签到前积分");
    }

    // 查找签到按钮
    const checkinBtn = page.getByRole("button", { name: /每日领积分/ });

    if (!(await checkinBtn.count()) || !(await checkinBtn.isVisible())) {
      result.alreadyChecked = true;
      console.log("📌 今日已签到 (签到按钮未显示)");
      try {
        const bEl = page.locator("text=/\\d+\\s*积分/").first();
        result.balanceAfter = (await bEl.textContent()) || "";
      } catch {}
      exitCode = 0;
      return { result, exitCode };
    }

    console.log("🎯 发现签到按钮，准备点击...");
    console.log("⏳ 正在完成人机验证并签到 (最多等待 90 秒)...");

    // 关键: click 之前先注册 response 监听器，避免竞态
    const responsePromise = page.waitForResponse(
      (resp) =>
        resp.url().includes("/api/v1/user/wallet/daily-temporary-credit"),
      { timeout: 90000 }
    );

    await checkinBtn.click();

    try {
      const resp = await responsePromise;
      const body = await resp.json().catch(() => ({}));
      console.log(`✅ 签到 API 响应: status=${resp.status()}`);
      if (body.code === 0 || body.success === true || resp.ok()) {
        result.success = true;
        console.log("🎉 签到 API 返回成功!");
      } else {
        result.errorMessage = body.message || JSON.stringify(body);
        console.log(`⚠️  ${result.errorMessage}`);
      }
    } catch (e) {
      result.errorMessage = `签到 API 在 90 秒内未响应: ${e.message}`;
      console.warn(`⚠️  ${result.errorMessage}`);
    }

    await page.waitForTimeout(2000);

    // 签到后积分
    try {
      const newBalanceEl = page.locator("text=/\\d+\\s*积分/").first();
      result.balanceAfter = (await newBalanceEl.textContent()) || "";
      console.log(`💰 签到后积分: ${result.balanceAfter.trim()}`);
    } catch {
      console.log("⚠️  未能获取签到后积分");
    }

    // 按钮状态兜底确认
    if (!(await checkinBtn.isVisible()).catch(() => false)) {
      result.success = true;
      console.log("🎉 签到按钮已消失，签到成功确认");
    } else {
      const btnText = (await checkinBtn.textContent()) || "";
      if (btnText.includes("已领取") || btnText.includes("已签到")) {
        result.success = true;
        console.log("🎉 状态显示已领取");
      } else if (!result.success && btnText.includes("每日领积分")) {
        console.log("⚠️  签到按钮仍显示每日领积分，签到可能未成功");
        await page.screenshot({ path: "debug-screenshot.png" });
        console.log("📸 已保存截图: debug-screenshot.png");
      }
    }

    exitCode = result.success ? 0 : 1;
  } catch (error) {
    result.errorMessage = error.message;
    console.error(`❌ 签到过程出错: ${error.message}`);
    try {
      if (browser) {
        const page = browser.contexts()[0]?.pages()[0];
        await page?.screenshot({ path: "error-screenshot.png" });
      }
    } catch {}
  } finally {
    try {
      if (browser) await browser.close();
    } catch {}
  }

  return { result, exitCode };
}

// ---------- 启动 ----------

(async function main() {
  const { result, exitCode } = await checkinCore();

  console.log("\n📋 === 签到完成 ===");
  await notifyMeow(result).catch((e) =>
    console.warn(`📡 MeoW 推送失败 (忽略): ${e.message}`)
  );

  if (result.errorMessage) {
    console.log(`ℹ️  详情: ${result.errorMessage}`);
  }
  process.exit(exitCode);
})();
