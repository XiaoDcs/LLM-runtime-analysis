# LLM 运行时长分析工具

一个用于从 `time.json` 会话日志中计算 LLM 真正运行时长（排除重试等待与等待用户回复）的小工具。当前项目包含：
- 根目录静态网页（`index.html`, `app.js`, `styles.css`）：纯前端解析，无需后端，可部署到 GitHub Pages
- Python CLI（`py/compute_llm_time.py`）：本地命令行离线分析
- `.gitignore` 已忽略 `time.json`

## 计算口径
- 运行片段汇总（Run-sum）：从每条 `assistant` 消息到其对应的 `tool` 结果所形成的窗口之和；遇到下一条 `assistant` 或任何 `user` 消息即结束当前窗口。
- 会话周期汇总（Cycle-sum）：以每条 `user` 消息为起点，统计到“下一条 `user` 出现前的最后一条非 `user` 消息”为止；将“Retry”视为 `user` 消息，从而排除重试等待与等待用户回复的时间。

## 目录结构
```
.
├── index.html         # 前端静态页（上传/粘贴 time.json 即可解析）
├── app.js             # 前端解析与计算逻辑（纯浏览器执行）
├── styles.css         # 前端样式
├── py/
│   └── compute_llm_time.py  # CLI：本地离线计算
├── .gitignore         # 忽略 time.json 等本地文件
└── README.md
```

## 本地使用
### A. 前端静态页（无需后端）
- 直接双击打开 `index.html`（或右键用浏览器打开）。
- 页面中选择/拖拽 `time.json`，或粘贴 JSON 文本，立即在本地浏览器解析。
- 支持切换显示时区（默认 UTC+8）与导出 CSV（Run/Cycle）。

可选：用本地静态服务器打开（例如）：
```bash
python3 -m http.server 8080
# 浏览器访问 http://localhost:8080
```

### B. Python CLI（离线）
```bash
python3 py/compute_llm_time.py /绝对路径/到/time.json
```
输出内容包含：
- 每个 Run 窗口（assistant → 对应 tool）
- 每个 Cycle 窗口（user 触发 → 下一个 user 出现前最后非 user）
- 两种口径的总时长

## GitHub Pages 部署
本项目前端为纯静态文件，适合 GitHub Pages。

1) 推送到 GitHub（你已设置远端并完成推送）。
2) 在 GitHub 仓库 Settings → Pages：
   - Source：Deploy from a branch
   - Branch：选择 `main`
   - Folder：选择 `/(root)`（根目录），保存
3) Pages 生效后，访问 `https://<你的用户名>.github.io/<仓库名>/` 打开页面，上传/粘贴 `time.json` 即可在浏览器端完成计算。

若你的 Pages 仅提供 `/docs` 作为目录选项，也可以将 `index.html / app.js / styles.css` 放到 `docs/` 后再选择 `/docs`。

## 数据隐私
- 前端版本为纯客户端解析：文件仅在浏览器内存中处理，不会上传到任何服务器。
- CLI 在本地运行，无网络传输。

## 自定义与扩展
- 若需更改是否计入某些 `tool` 类型或进一步细分窗口边界，请分别修改：
  - 前端：`app.js` 中 `computeRuns` 与 `computeCycles`
  - CLI：`py/compute_llm_time.py` 中对应的计算函数
- 可加筛选（按会话/时间区间/消息类型）、记忆时区、最近文件列表等增强功能。

## 常见问题
- 时间戳解析异常：本工具已对 `Z` 与 `±HH:MM` 时区、可变长度小数秒做了兼容处理；若仍报错，请检查 `time.json` 时间格式是否标准 ISO8601。
- 页面无输出：请打开浏览器 DevTools Console 查看 JSON 结构是否为 `{ data: [...] }`，或是否为空。 