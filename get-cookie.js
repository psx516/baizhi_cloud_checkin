/**
 * 百智云 Cookie 导出工具
 * 用 Playwright 打开有头浏览器，让用户手动扫码登录后，自动导出 cookie 为 JSON
 *
 * 使用方法:
 *   node get-cookie.js
 *
 * 运行后会打开一个浏览器窗口:
 *   1. 用微信扫码登录百智云控制台
 *   2. 登录成功后，在浏览器控制台(按 F12)或终端按回车结束
 *   3. cookie 会保存到 cookies.json
 *   4. 将 cookies.json 的内容粘贴到 GitHub Secrets (名称: COOKIE_JSON)
 */

const { chromium } = require("playwright");
const fs = require("fs");

async function main() {
  console.log("🔐 启动浏览器，请在弹出的窗口中扫码登录...\n");

  const browser = await chromium.launch({
    headless: false,
    args: ["--start-maximized"],
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
  });

  const page = await context.newPage();

  // 访问登录后的页面
  await page.goto("https://baizhi.cloud/console/apps");

  console.log("⏳ 等待登录... (如果已自动登录则无需操作)");
  console.log("登录成功后，回到这里按回车键导出 cookie\n");

  // 轮询检查是否已登录
  const loginCheck = setInterval(async () => {
    const url = page.url();
    if (!url.includes("/sign-in") && !url.includes("/login")) {
      // 已登录
      clearInterval(loginCheck);
      console.log("✅ 检测到登录成功!");
      console.log("按回车键导出 cookie...");
    }
  }, 1000);

  // 等待用户按回车
  await new Promise((resolve) => {
    process.stdin.once("data", resolve);
    // 也可以监听 page close
    page.on("close", resolve);
  });

  clearInterval(loginCheck);

  // 导出 storage state
  const storageState = await context.storageState();
  console.log(`\n📦 导出了 ${storageState.cookies.length} 个 cookies`);

  // 保存到文件
  fs.writeFileSync("cookies.json", JSON.stringify(storageState.cookies, null, 2));
  console.log("✅ Cookie 已保存到 cookies.json");

  console.log("\n📋 GitHub Actions 需要配置 2 个 Secrets:");
  console.log("");
  console.log("  https://github.com/<你的仓库>/settings/secrets/actions");
  console.log("");
  console.log("  ┌─ COOKIE_JSON ── cookie 认证 ─────────────────────────┐");
  console.log("  │  Value: cookies.json 的完整内容                       │");
  console.log("  └──────────────────────────────────────────────────────┘");
  console.log("");
  console.log("  ┌─ MEOW_USERID ── MeoW 推送昵称 (可选) ────────────────┐");
  console.log("  │  先在 https://www.chuckfang.com/ 注册拿到昵称         │");
  console.log("  │  不填则跳过推送，脚本照常签到                          │");
  console.log("  └──────────────────────────────────────────────────────┘");
  console.log("");
  console.log("配置完成后，推送到 GitHub Actions 会每天自动执行 ✨");

  await browser.close();
}

main().catch(console.error);
