# Pi Session Viewer (Pi 会话分析)

[English](README.md) | [简体中文](README.zh-CN.md)

为 [Pi](https://github.com/earendil-works/pi) 编程助手量身打造的本地只读会话可视化与系统提示词（System Prompt）分析面板。直观呈现多轮时间轴、工具调用因果链以及提示词快照结构。

![Pi Session Viewer 预览图](https://raw.githubusercontent.com/hfrancisla/pi-session-viewer/main/assets/gallery-preview.webp)

## 安装

```bash
pi install npm:@hfrancisla/pi-session-viewer
```

重启 Pi 或执行 `/reload`。扩展将自动加载，并在下一轮对话起开始捕获系统提示词。

Pi 通过 TypeScript 入口加载后端，确保 `/reload` 使用最新源码，而非复用 Node 缓存的已编译 ESM。本地更新后运行 `npm run build`，然后执行 `/reload` 与 `/session-viewer on`，并使用新打开的面板标签页。

## 使用方法

```text
/session-viewer       # 启动面板（等同于 on）
/session-viewer on    # 启动面板并在浏览器中打开
/session-viewer off   # 关闭面板（系统提示词捕获仍继续工作）
```

- 启动面板后会在浏览器中打开带有独立访问令牌的本地仪表盘。
- 切换会话时（`/new`、`/resume`、`/fork`），需重新执行 `/session-viewer on`。
- 直接从 Pi 本地存储发现会话，或通过浏览器导入任意 `.jsonl` 会话文件。
- 打开会话之前即索引保存的名称。首次目录扫描逐文件读取一次，后续复用持久化索引，仅读取追加数据。元数据缓存位于 `~/.pi/agent/cache/pi-session-viewer/session-names`（或 `PI_CODING_AGENT_DIR` 下），可用 `PI_SESSION_VIEWER_CACHE_DIR` 改变位置。删除缓存会安全重建；无法写入缓存时退回内存索引。
- 桌面端可拖动两侧分隔条调整侧栏宽度，浏览器会为面板的当前源记住选择。分隔条支持方向键（Shift 加大步长）、Home/End 调整到宽度边界，双击可恢复该侧栏默认宽度。
- 除非浏览器的首选语言是中文，否则默认使用英文。通过 EN/中 按钮显式选择的语言优先，且会被记住。
- 默认使用深色模式。点击语言切换与刷新按钮之间的太阳/月亮按钮切换主题；浏览器会为面板的当前源记住选择。

## 核心特性

- **时间线顺序**：通过中央面板计数右侧的上下箭头切换“最早在前 / 最新在前”，当前方向高亮，自动记住偏好，不改变事件选择与筛选。
- **阅读视图**：双击时间线事件，用大尺寸可滚动弹窗阅读完整 Markdown/文本。也可点击书本按钮或按 Shift+Enter 打开，支持切换源码；可用 Escape、关闭按钮或遮罩退出。
- **时间轴与调用因果链**：默认仅显示用户与 Pi 回复。通过筛选器启用 Thinking、工具调用/结果等事件类型，可查看对应的调用时序因果导轨。
- **系统提示词结构拆解**：深度解析系统提示词的组成，包括基础模板、挂载工具、Skills 以及上下文参考文件。
- **多项目会话目录**：按工作目录归类会话，并对重名目录进行自动路径消歧。
- **离线 JSONL 导入**：支持直接选取本地会话文件进行离线分析。

## 安全与隐私

- **仅限本地访问**：严格监听 `127.0.0.1`，并为每次启动生成独立的 Bearer Token。无云端同步、无遥测上报、无远程访问。
- **只读设计**：Web 界面无法修改会话或执行任何终端命令。
- **捕获范围**：仅在本地会话文件中记录系统提示词、Skill 元数据与上下文文件快照。**绝不**记录 API Key、请求标头或敏感凭证。
- **历史记录**：没有关联系统提示词捕获记录的轮次会显示为 *未记录*；Viewer 不推断缺失原因，也不会根据当前配置重建历史提示词。

## 本地开发

```bash
npm install
npm run dev        # Web 开发服务器
npm test           # 单元与集成测试
npm run build      # 构建 Web 静态资产与扩展产物
npm run verify     # 完整验证套件
```

会话目录查找顺序：`PI_CODING_AGENT_SESSION_DIR` → `~/.pi/agent/settings.json` → `~/.pi/agent/sessions`。
