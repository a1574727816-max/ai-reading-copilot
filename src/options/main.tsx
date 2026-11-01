import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  BookOpen,
  Check,
  ChevronRight,
  Eye,
  EyeOff,
  LoaderCircle,
  Settings,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import {
  DEFAULT_MODEL,
  DEFAULT_PREFERENCES,
  type ModelConfig,
  type Preferences,
} from "../types";
import { apiUrl, createProvider } from "../services/llm";
import {
  clearCredentials,
  clearDocuments,
  clearHistory,
  loadKey,
  loadSettings,
  saveModel,
  savePreferences,
} from "../services/storage";
import { errorText } from "../utils";
import { useTheme } from "../ui/theme";
import "../ui/styles.css";
function Options() {
  const [prefs, setPrefs] = useState<Preferences>(DEFAULT_PREFERENCES),
    [config, setConfig] = useState<ModelConfig>(DEFAULT_MODEL),
    [key, setKey] = useState(""),
    [showKey, setShowKey] = useState(false),
    [models, setModels] = useState<string[]>([]),
    [busy, setBusy] = useState(""),
    [notice, setNotice] = useState(""),
    [error, setError] = useState(""),
    [clear, setClear] = useState<"documents" | "history" | "all" | null>(null),
    [origins, setOrigins] = useState<string[]>([]);
  useTheme(prefs.theme);
  useEffect(() => {
    void Promise.all([
      loadSettings(),
      loadKey(),
      chrome.storage.local.get("siteOrigins"),
    ])
      .then(([s, k, o]) => {
        setPrefs(s.preferences);
        setConfig(s.config);
        setKey(k);
        setOrigins(Array.isArray(o.siteOrigins) ? o.siteOrigins : []);
      })
      .catch((e) => setError(errorText(e)));
  }, []);
  const preference = <K extends keyof Preferences>(
    name: K,
    value: Preferences[K],
  ) => setPrefs((p) => ({ ...p, [name]: value }));
  const model = <K extends keyof ModelConfig>(name: K, value: ModelConfig[K]) =>
    setConfig((c) => ({ ...c, [name]: value }));
  function permission() {
    const u = new URL(apiUrl(config.baseUrl, "models"));
    return chrome.permissions.request({ origins: [u.origin + "/*"] });
  }
  async function run(action: "save" | "models" | "test") {
    setBusy(action);
    setError("");
    setNotice("");
    try {
      if (!key.trim()) throw new Error("请填写 API Key。");
      if (!config.baseUrl.trim()) throw new Error("请填写接口 Base URL。");
      if (!(await permission())) throw new Error("未获得模型服务访问权限。");
      if (action === "models") {
        const ids = await createProvider(config, key.trim()).models();
        setModels(ids);
        if (!config.model && ids.length) model("model", ids[0]);
        setNotice(
          ids.length
            ? `已读取 ${ids.length} 个可用模型。`
            : "模型列表为空，可以手动填写模型 ID。",
        );
      } else if (action === "test") {
        const result = await createProvider(config, key.trim()).complete(
          [{ role: "user", content: "Reply only OK." }],
          { maxTokens: 32, timeoutMs: 30000 },
        );
        setNotice(result.text ? "真实生成请求成功。" : "请求完成。");
      } else {
        if (!config.model.trim())
          throw new Error("请选择模型或手动填写模型 ID。");
        const previous = await loadSettings();
        const nextPrefs =
          previous.config.baseUrl !== config.baseUrl
            ? { ...prefs, consent: false }
            : prefs;
        await saveModel(config, key);
        await savePreferences(nextPrefs);
        setPrefs(nextPrefs);
        setNotice("模型与偏好设置已保存。");
      }
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy("");
    }
  }
  async function saveOnlyPreferences() {
    setError("");
    try {
      await savePreferences(prefs);
      setNotice("阅读偏好已保存。");
    } catch (e) {
      setError(errorText(e));
    }
  }
  async function removeData() {
    try {
      if (clear === "documents" || clear === "all") await clearDocuments();
      if (clear === "history" || clear === "all") await clearHistory();
      if (clear === "all") {
        await clearCredentials();
        await chrome.storage.session.clear();
        setKey("");
        await savePreferences(DEFAULT_PREFERENCES);
        setPrefs(DEFAULT_PREFERENCES);
        await chrome.storage.local.remove("modelConfig");
        setConfig(DEFAULT_MODEL);
        for (const origin of origins)
          await chrome.permissions.remove({ origins: [origin] });
        await chrome.storage.local.remove("siteOrigins");
        setOrigins([]);
      }
      await chrome.storage.local.set({
        dataClearedAt: { at: Date.now(), type: clear },
      });
      setNotice("所选本地数据已删除。");
      setClear(null);
    } catch (e) {
      setError(errorText(e));
    }
  }
  const toggle = (
    label: string,
    description: string,
    name: "overlay" | "stream" | "retainHistory" | "allowFullDocument",
  ) => (
    <label className="toggle-row">
      <span>
        <strong>{label}</strong>
        <small>{description}</small>
      </span>
      <input
        type="checkbox"
        checked={prefs[name]}
        onChange={(e) => preference(name, e.target.checked)}
      />
    </label>
  );
  return (
    <div className="settings-shell">
      <aside className="settings-nav">
        <div className="brand">
          <span className="brand-mark">
            <BookOpen size={21} />
          </span>
          <span>
            READING <strong>COPILOT</strong>
            <small>阅读助手 / 本地设置</small>
          </span>
        </div>
        <a href="#model" className="nav-item">
          <Settings size={16} />
          模型服务
          <ChevronRight size={14} />
        </a>
        <a href="#reading" className="nav-item">
          <BookOpen size={16} />
          阅读偏好
          <ChevronRight size={14} />
        </a>
        <a href="#privacy" className="nav-item">
          <ShieldCheck size={16} />
          隐私与数据
          <ChevronRight size={14} />
        </a>
        <div className="nav-foot">
          YOUR KEY. YOUR CONTEXT.
          <br />
          LOCAL FIRST · V1.0
        </div>
      </aside>
      <main className="settings-main">
        <div className="eyebrow">MAKE IT YOURS</div>
        <h1>给阅读，配好助手。</h1>
        <p className="settings-intro">
          选择自己的模型服务，让解释贴合你的阅读方式。
        </p>
        {error && (
          <div className="alert" role="alert">
            {error}
          </div>
        )}
        {notice && (
          <div className="success" role="status">
            <Check size={16} />
            {notice}
          </div>
        )}
        <section id="model" className="settings-section">
          <div className="section-heading">
            <div>
              <span className="section-number">01 / CONNECTION</span>
              <h2>模型服务</h2>
            </div>
            <span className="tag">BYOK</span>
          </div>
          <div className="field-grid">
            <label>
              服务类型
              <select
                aria-label="服务类型"
                value={config.provider}
                onChange={(e) => {
                  const provider = e.target.value as ModelConfig["provider"];
                  setModels([]);
                  setConfig((c) => ({
                    ...c,
                    provider,
                    baseUrl:
                      provider === "deepseek"
                        ? DEFAULT_MODEL.baseUrl
                        : c.baseUrl,
                    model: "",
                  }));
                }}
              >
                <option value="deepseek">DeepSeek 官方</option>
                <option value="compatible">自定义 · OpenAI-compatible</option>
              </select>
            </label>
            <label>
              密钥保存方式
              <select
                aria-label="密钥保存方式"
                value={config.keyMode}
                onChange={(e) =>
                  model("keyMode", e.target.value as ModelConfig["keyMode"])
                }
              >
                <option value="session">仅本次浏览器会话</option>
                <option value="local">保存在这台设备</option>
              </select>
            </label>
            <label className="full">
              API Base URL
              <input
                aria-label="API Base URL"
                value={config.baseUrl}
                onChange={(e) => model("baseUrl", e.target.value)}
                placeholder="https://api.deepseek.com"
                spellCheck={false}
              />
              <small>
                填写基础地址，可含 /v1。浏览器会按该服务域名申请访问权限。
              </small>
            </label>
            <label className="full">
              API Key
              <div className="key-field">
                <input
                  aria-label="API Key"
                  type={showKey ? "text" : "password"}
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  placeholder="输入你自己的 API Key"
                  autoComplete="off"
                  spellCheck={false}
                />
                <button
                  className="icon-button"
                  aria-label={showKey ? "隐藏密钥" : "显示密钥"}
                  onClick={() => setShowKey(!showKey)}
                >
                  {showKey ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </div>
              <small>
                {config.keyMode === "local"
                  ? "密钥保存于本机扩展存储，本机用户或恶意软件可能读取。不会同步到云端，也不会传给网页。"
                  : "关闭浏览器会话后需要重新填写密钥。密钥不会传给网页或保存在对话中。"}
              </small>
            </label>
            <label className="full">
              模型 ID
              <div className="model-field">
                <input
                  aria-label="模型 ID"
                  list="available-models"
                  value={config.model}
                  onChange={(e) => model("model", e.target.value)}
                  placeholder="获取列表或手动填写模型 ID"
                  spellCheck={false}
                />
                <datalist id="available-models">
                  {models.map((m) => (
                    <option value={m} key={m} />
                  ))}
                </datalist>
                <button
                  className="button secondary"
                  disabled={!!busy}
                  onClick={() => void run("models")}
                >
                  {busy === "models" ? (
                    <LoaderCircle size={15} className="spin" />
                  ) : (
                    "获取模型"
                  )}
                </button>
              </div>
              <small>
                列表接口不可用时可手动填写。不同服务的模型与参数支持情况可能不同。
              </small>
            </label>
            <label>
              最大输出 tokens
              <input
                type="number"
                min="32"
                max="65536"
                value={config.maxTokens}
                onChange={(e) =>
                  model(
                    "maxTokens",
                    Math.max(
                      32,
                      Math.min(65536, Number(e.target.value) || 2048),
                    ),
                  )
                }
              />
            </label>
            <label>
              温度（可留空）
              <input
                type="number"
                min="0"
                max="2"
                step="0.1"
                value={config.temperature ?? ""}
                onChange={(e) =>
                  model(
                    "temperature",
                    e.target.value === ""
                      ? undefined
                      : Math.max(0, Math.min(2, Number(e.target.value))),
                  )
                }
              />
              <small>留空时不发送此参数，适用于不支持温度的服务。</small>
            </label>
          </div>
          <div className="section-actions">
            <button
              className="button secondary"
              disabled={!!busy}
              onClick={() => void run("test")}
            >
              {busy === "test" ? (
                <LoaderCircle size={15} className="spin" />
              ) : null}
              测试真实连接
            </button>
            <button
              className="button"
              disabled={!!busy}
              onClick={() => void run("save")}
            >
              {busy === "save" ? (
                <LoaderCircle size={15} className="spin" />
              ) : null}
              保存模型与偏好
            </button>
          </div>
          <p className="fine-print">
            连接测试会发送一条极短的生成请求，按服务商规则计费。
          </p>
        </section>
        <section id="reading" className="settings-section">
          <div className="section-heading">
            <div>
              <span className="section-number">02 / READING</span>
              <h2>阅读偏好</h2>
            </div>
          </div>
          <div className="field-grid">
            <label>
              解释语言
              <input
                value={prefs.language}
                maxLength={50}
                onChange={(e) =>
                  preference("language", e.target.value || "中文")
                }
              />
            </label>
            <label>
              解释详细度
              <select
                value={prefs.detail}
                onChange={(e) =>
                  preference("detail", e.target.value as Preferences["detail"])
                }
              >
                <option value="brief">简短 · 快速继续阅读</option>
                <option value="normal">适中 · 解释并举例</option>
                <option value="deep">深入 · 原理与边界</option>
              </select>
            </label>
            <label>
              外观
              <select
                aria-label="外观"
                value={prefs.theme}
                onChange={(e) =>
                  preference("theme", e.target.value as Preferences["theme"])
                }
              >
                <option value="system">跟随系统</option>
                <option value="light">浅色</option>
                <option value="dark">深色</option>
              </select>
            </label>
            <label>
              原文上下文预算（字符）
              <input
                type="number"
                min="4000"
                max="32000"
                step="1000"
                value={prefs.contextBudget}
                onChange={(e) =>
                  preference(
                    "contextBudget",
                    Math.max(
                      4000,
                      Math.min(32000, Number(e.target.value) || 12000),
                    ),
                  )
                }
              />
              <small>不包含系统提示与有限历史；字符数不等同于 token 数。</small>
            </label>
          </div>
          {toggle("划词浮层", "仅在你主动启用或已授权的网站显示。", "overlay")}
          {toggle("流式输出", "边生成边阅读，可随时停止。", "stream")}
          {toggle(
            "保存对话历史",
            "只保存在这台设备，可单独删除。",
            "retainHistory",
          )}
          {toggle(
            "允许发送完整文档",
            "允许对长文档进行分批全文概括；关闭时只发送检索片段。",
            "allowFullDocument",
          )}
          <div className="section-actions">
            <button
              className="button"
              onClick={() => void saveOnlyPreferences()}
            >
              保存阅读偏好
            </button>
          </div>
        </section>
        <section id="privacy" className="settings-section">
          <div className="section-heading">
            <div>
              <span className="section-number">03 / YOUR DATA</span>
              <h2>隐私与本地数据</h2>
            </div>
            <ShieldCheck size={23} />
          </div>
          <p className="privacy-text">
            网页内容仅在你主动使用阅读功能时提取。调用模型时，必要内容会发给你配置的服务。本插件无账号、无强制后端，不上传浏览记录。
          </p>
          <label className="full block-domain">
            禁用域名
            <textarea
              rows={3}
              placeholder="每行一个域名，例如 mail.example.com"
              value={prefs.blockedDomains.join("\n")}
              onChange={(e) =>
                preference(
                  "blockedDomains",
                  e.target.value
                    .split("\n")
                    .map((x) => x.trim().toLowerCase())
                    .filter(Boolean),
                )
              }
            />
            <small>禁用项同时覆盖其子域名；保存后生效。</small>
          </label>
          <div className="section-actions">
            <button
              className="button secondary"
              onClick={() => void saveOnlyPreferences()}
            >
              保存禁用列表
            </button>
          </div>
          <div className="authorized-sites">
            <h3>已持续授权的网站</h3>
            {!origins.length ? (
              <p className="fine-print">暂无。可在侧边栏授予当前网站权限。</p>
            ) : (
              origins.map((origin) => (
                <div className="authorized-row" key={origin}>
                  <span>{origin}</span>
                  <button
                    className="text-button"
                    onClick={() =>
                      void chrome.permissions
                        .remove({ origins: [origin] })
                        .then(async () => {
                          const next = origins.filter((o) => o !== origin);
                          setOrigins(next);
                          await chrome.storage.local.set({ siteOrigins: next });
                        })
                    }
                  >
                    撤销授权
                  </button>
                </div>
              ))
            )}
          </div>
          <div className="data-actions">
            <button
              className="button secondary"
              onClick={() => setClear("documents")}
            >
              <Trash2 size={14} />
              清除文档缓存
            </button>
            <button
              className="button secondary"
              onClick={() => setClear("history")}
            >
              <Trash2 size={14} />
              删除全部对话
            </button>
            <button className="button danger" onClick={() => setClear("all")}>
              重置全部本地数据
            </button>
          </div>
        </section>
        <footer className="settings-footer">
          AI READING COPILOT <span>解释有上下文，回答有出处。</span>
        </footer>
      </main>
      {clear && (
        <div className="modal-backdrop">
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label="确认清理数据"
          >
            <Trash2 size={25} />
            <h2>
              {clear === "documents"
                ? "清除文档缓存？"
                : clear === "history"
                  ? "删除全部对话？"
                  : "重置全部本地数据？"}
            </h2>
            <p>
              {clear === "all"
                ? "将删除密钥、偏好、文档缓存和全部对话，并撤销持续授权的网站。此操作不可恢复。"
                : "所选数据将从本机删除，此操作不可恢复。"}
            </p>
            <div className="modal-actions">
              <button
                className="button secondary"
                onClick={() => setClear(null)}
              >
                取消
              </button>
              <button
                className="button danger"
                onClick={() => void removeData()}
              >
                确认删除
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Options />
  </React.StrictMode>,
);
