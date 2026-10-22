## 百智云自动签到脚本 📝
### 项目结构

```
baizhiyunqd
├── .github/workflows/daily-checkin.yml ← GitHub Actions 定时任务
├── checkin.js                          ← Playwright 签到脚本
├── get-cookie.js                       ← 一键导出 Cookie 工具
├── package.json                        ← 依赖配置
└── .gitignore
```

### 技术方案
| 组件 | 说明 |
| --- | --- |
| 签到接口 | `POST /api/v1/user/wallet/daily-temporary-credit`|
| 认证方式 | HttpOnly Session Cookie（无法 JS 直接读取） |
| 验证码 | WASM PoW（Proof of Work）captcha —`FNV-1a + xorshift` 哈希 |
| 方案 | Playwright Headless Chromium — 让浏览器自然跑 WASM captcha|

### ⚡ 使用步骤（3 步搞定）
第 1 步：获取 Cookie

最简单的方式，运行我给你写的导出工具：

```Bash
node get-cookie.js
```

浏览器会打开百智云登录页，扫码登录后回到终端按回车，cookie 会保存到`cookies.json` 。

或者手动方式：浏览器 DevTools → Network → 任选请求 → Request Headers → 复制`Cookie:` 后面的完整字符串。

第 2 步：配置 GitHub Actions Secret

1. Fork 这个仓库（或新建仓库），提交所有文件
2. 打开`https://github.com/<你>/<仓库>/settings/secrets/actions`
3. 新建 Secret：
   - 推荐 ：Name =`COOKIE_JSON` ，Value =`cookies.json` 的完整内容
   - 备选 ：Name =`COOKIE_STRING` ，Value = 直接从浏览器复制的 cookie 字符串
   - 可选 ：Name =`MEOW_USERID` ，Value = meow 用户 ID
   
第 3 步：等它自动跑

每天 UTC 16:10 = 北京时间 00:10 自动签到。也可以随时在 Actions 页面手动触发（workflow_dispatch）。

### ⚠️ 注意事项
- Cookie 有效期 ：Session Cookie 通常几天到几周过期，过期后需重新运行`get-cookie.js` 更新 Secret
- 签到结果 ：运行完成后在 GitHub Actions Log 里可以看到积分变化；如果签到失败会自动保存截图到 Artifacts
- MeoW 推送 — POST JSON + 有条件触发；`MEOW_USERID` 未配置 → 静默跳过，脚本照样签到
