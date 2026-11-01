# AI Reading Copilot v1.0.0

首个公开版本：在当前网页中解释术语、代码和公式，并通过侧边栏围绕文档连续问答、点击真实原文引用定位。支持用户自带 DeepSeek 或 OpenAI-compatible 服务密钥，本地优先，无账号、无强制后端。

## 下载与安装

1. 下载附件 **ai-reading-copilot-1.0.0-extension.zip**，解压到 Windows 本机的固定文件夹。
2. Chrome 打开 `chrome://extensions`，Edge 打开 `edge://extensions`。
3. 开启“开发者模式”，点击“加载已解压的扩展程序”，选择包含 `manifest.json` 的解压目录。
4. 将阅读助手固定到工具栏，打开侧边栏中的设置，填写 API Key、获取或填写模型 ID，测试连接后保存。
5. 打开文档网页，点击扩展图标读取正文，再划词解释或在侧边栏提问。

详细教程：[README](https://github.com/a1574727816-max/ai-reading-copilot#readme)。

安装扩展使用 `extension.zip`。`source.zip` 是完整源码，GitHub 自动生成的 “Source code” 附件同样需要自行构建。两个包均不包含个人 API Key。

## 功能

- 网页划词解释、通俗解释、举例与侧边栏深入追问。
- 正文、标题层级、代码、表格与链接提取；长文档分块、关键词/BM25 检索及分批全文概括。
- 流式回答、停止生成、重新生成、Markdown、代码高亮、LaTeX 与复制。
- 真实片段引用、原文校验、滚动定位和短暂高亮；无法可靠定位时明确提示。
- 文档/标签页/版本会话隔离、SPA 更新识别、本地历史、缓存及独立清理。
- DeepSeek 官方和 OpenAI-compatible 接口、自定义地址与模型、模型列表、连接测试、会话/本机密钥保存。
- 按站点授权、禁用域名、首次发送提示、明暗主题与阅读偏好。

## 验证

- TypeScript 检查、生产构建、24 项单元测试、9 项真实 Chromium 扩展端到端测试通过。
- DeepSeek 官方接口的真实普通和流式调用通过；真实网页问答产生 5 个已校验的引用，点击原文定位通过。
- 源码包已完成独立解压、安装依赖、类型检查、测试和构建验证。
- ZIP 完整性、SHA-256、生产权限与个人密钥排除检查通过。

复核记录：[测试报告](https://github.com/a1574727816-max/ai-reading-copilot/blob/main/docs/TEST_REPORT.md)。

## 已知限制

- 自动化运行于 Linux Chromium；Windows Chrome / Edge 的本机安装与系统交互仍需实际设备复核。
- 宇树站点在测试环境返回访问限制页，扩展会明确报错，未将目标正文兼容性算作通过。
- 庐山派入口以图片为主，首版只能分析可提取的网页文字；不支持图片 OCR、PDF、跨网页集合和联网搜索。
- 当前文档指当前网页；全文概括仅覆盖已提取文字，无法代表图片、未加载内容或其他章节。

更多边界见 [已知限制](https://github.com/a1574727816-max/ai-reading-copilot/blob/main/docs/KNOWN_LIMITATIONS.md)。

## 附件

- `ai-reading-copilot-1.0.0-extension.zip`：可直接解压加载的扩展。
- `ai-reading-copilot-1.0.0-source.zip`：包含说明、测试与构建脚本的完整源码。
- `checksums.txt`：两个 ZIP 的 SHA-256 校验值。
- `source-build-verification.json`：对应源码包的独立构建验证记录。
