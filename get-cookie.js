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

  // 同时输出到剪贴板格式提示
  console.log("\n📋 在 GitHub Actions 中使用:");
  console.log("1. 打开 https://github.com/<你的用户名>/baizhiyunqd/settings/secrets/actions");
  console.log("2. 点击 New repository secret");
  console.log("3. Name 填: COOKIE_JSON");
  console.log("4. Value 填: cookies.json 文件的完整内容");
  console.log("5. 点击 Add secret");

  await browser.close();
}

main().catch(console.error);
