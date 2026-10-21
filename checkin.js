/**
 * 百智云 (baizhi.cloud) 自动签到脚本
 * 使用 Playwright 驱动 headless Chromium，让浏览器自动完成 WASM captcha 验证
 *
 * 使用方法:
 *   1. 在 GitHub 仓库 Settings → Secrets and variables → Actions 中添加:
 *      - COOKIE_STRING: 从浏览器 DevTools 复制的完整 cookie 字符串
 *        （登录后在 Network 面板 → 任一请求 → Request Headers → Cookie 字段复制）
 *      或者
 *      - COOKIE_JSON:   从 DevTools Application → Cookies → Export Cookies (EditThisCookie 插件)
 *        导出的 JSON 数组内容
 *
 *   2. 可选: COOKIE_DOMAIN (默认 baizhi.cloud)
 */

const { chromium } = require("playwright");

async function checkin() {
  const cookieString = process.env.COOKIE_STRING || "";
  const cookieJson = process.env.COOKIE_JSON || "";
  const cookieDomain = process.env.COOKIE_DOMAIN || "baizhi.cloud";

  if (!cookieString && !cookieJson) {
    console.error("❌ 错误: 未设置 COOKIE_STRING 或 COOKIE_JSON 环境变量");
    console.error(
      "请在 GitHub Actions Secrets 中配置你的百智云登录 Cookie"
    );
    process.exit(1);
  }

  let cookies = [];

  if (cookieJson) {
    // 使用 JSON 格式 cookie (EditThisCookie 插件导出)
    try {
      const parsed = JSON.parse(cookieJson);
      cookies = parsed.map((c) => ({
        name: c.name,
        value: c.value,
        domain: c.domain || `.${cookieDomain}`,
        path: c.path || "/",
        httpOnly: c.httpOnly || false,
        secure: c.secure || false,
        sameSite: c.sameSite || "Lax",
      }));
    } catch (e) {
      console.error("❌ COOKIE_JSON 解析失败:", e.message);
      process.exit(1);
    }
  } else {
    // 使用 cookie 字符串格式 (从 Request Headers 直接复制)
    cookies = cookieString.split(";").map((pair) => {
      const [name, ...rest] = pair.trim().split("=");
      const value = rest.join("=");
      return {
        name: name.trim(),
        value: value.trim(),
        domain: `.${cookieDomain}`,
        path: "/",
        httpOnly: false,
        secure: true,
        sameSite: "Lax",
      };
    });
  }

  console.log(`🔑 加载了 ${cookies.length} 个 cookie`);

  const browser = await chromium.launch({
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

  // 监听 console 和网络请求用于调试
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      console.log(`   [浏览器错误] ${msg.text().slice(0, 200)}`);
    }
  });

  try {
    console.log("🌐 正在访问百智云控制台...");
    await page.goto("https://baizhi.cloud/console/apps", {
      waitUntil: "networkidle",
      timeout: 30000,
    });

    // 检查是否被重定向到登录页
    const url = page.url();
    if (url.includes("/sign-in") || url.includes("/login")) {
      console.error(
        "❌ Cookie 已失效! 被重定向到登录页。请重新登录并更新 Cookie。"
      );
      process.exit(1);
    }

    console.log("✅ 登录状态验证通过");

    // 等待页面加载完成
    await page.waitForTimeout(2000);

    // 获取当前积分
    let currentBalance = "";
    try {
      const balanceEl = page.locator("text=/\\d+\\s*积分/").first();
      currentBalance = (await balanceEl.textContent()) || "";
      console.log(`💰 当前积分: ${currentBalance.trim()}`);
    } catch (e) {
      console.log("⚠️  未能获取当前积分");
    }

    // 查找签到按钮
    const checkinBtn = page.getByRole("button", { name: /每日领积分/ });

    if (!(await checkinBtn.count()) || !(await checkinBtn.isVisible())) {
      console.log(
        "📌 今日已签到 (签到按钮未显示) 或者页面结构有变化"
      );
      process.exit(0);
    }

    console.log("🎯 发现签到按钮，准备点击...");

    // 关键: 在点击之前先注册 response 监听器 (Promise.all 模式)
    // 否则请求可能在监听器设置前就已经完成
    console.log("⏳ 正在完成人机验证并签到 (最多等待 90 秒)...");

    const responsePromise = page.waitForResponse(
      (resp) =>
        resp.url().includes("/api/v1/user/wallet/daily-temporary-credit"),
      { timeout: 90000 }
    );

    await checkinBtn.click();

    // 等待签到 API 响应
    let checkinOk = false;
    try {
      const resp = await responsePromise;
      const body = await resp.json().catch(() => ({}));
      console.log(`✅ 签到 API 响应: status=${resp.status()}`);
      if (body.code === 0 || body.success === true || resp.ok()) {
        console.log("🎉 签到 API 返回成功!");
        checkinOk = true;
      } else {
        console.log(`⚠️  API 返回: ${body.message || JSON.stringify(body)}`);
      }
    } catch (e) {
      console.log("⚠️  签到 API 在 90 秒内未响应，继续检查页面状态...");
    }

    await page.waitForTimeout(2000);

    // 检查签到结果
    const newBalanceEl = page.locator("text=/\\d+\\s*积分/").first();
    const newBalance = (await newBalanceEl.textContent()) || "";
    console.log(`💰 签到后积分: ${newBalance.trim()}`);

    // 检查签到按钮是否消失
    if (!(await checkinBtn.isVisible()).catch(() => false)) {
      console.log("🎉 签到成功! 签到按钮已消失");
    } else {
      // 检查按钮文字是否变化
      const btnText = (await checkinBtn.textContent()) || "";
      if (btnText.includes("已领取") || btnText.includes("已签到")) {
        console.log("🎉 签到成功! 状态显示已领取");
      } else if (btnText.includes("每日领积分")) {
        console.log("⚠️  签到按钮仍显示每日领积分，可能签到未成功");
        // 截个图用于调试
        await page.screenshot({ path: "debug-screenshot.png" });
        console.log("📸 已保存截图: debug-screenshot.png");
      }
    }

    console.log("\n📋 === 签到完成 ===");
    console.log(`时间: ${new Date().toLocaleString("zh-CN")}`);
    if (currentBalance && newBalance) {
      console.log(`积分变化: ${currentBalance.trim()} → ${newBalance.trim()}`);
    }
  } catch (error) {
    console.error("❌ 签到过程出错:", error.message);
    await page.screenshot({ path: "error-screenshot.png" }).catch(() => {});
    process.exit(1);
  } finally {
    await browser.close();
  }
}

checkin();
