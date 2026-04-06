import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Palette, Bot, Camera, Link as LinkIcon, HardDrive, X, Target } from "lucide-react";
import {
  useSettingsStore,
  MODELS_BY_PROVIDER,
  PROVIDER_LABELS,
  type AIProvider,
  type ThemeMode,
  type BubbleStyle,
  type BubblePosition,
  type DefaultAction,
} from "../../stores/settingsStore";

const BUBBLE_POSITION_OPTIONS: { value: BubblePosition; label: string; icon: string }[] = [
  { value: "bottom-right", label: "右下", icon: "↘" },
  { value: "bottom-center", label: "下方居中", icon: "↓" },
  { value: "bottom-left", label: "左下", icon: "↙" },
  { value: "top-right", label: "右上", icon: "↗" },
  { value: "top-center", label: "上方居中", icon: "↑" },
  { value: "top-left", label: "左上", icon: "↖" },
];

const THEME_OPTIONS: { value: ThemeMode; label: string; icon: string }[] = [
  { value: "light", label: "浅色", icon: "☀️" },
  { value: "dark", label: "深色", icon: "🌙" },
  { value: "system", label: "跟随系统", icon: "💻" },
];

export function SettingsView() {
  const {
    apiKey,
    provider,
    model,
    theme,
    captureEnabled,
    captureMode,
    bubbleStyle,
    bubblePosition,
    countdownDuration,
    sensitiveFilterEnabled,
    urlReadingEnabled,
    radarIntervalDays,
    screenshotDir,
    totalItems,
    diskUsageMB,
    setApiKey,
    setProvider,
    setModel,
    setTheme,
    setCaptureEnabled,
    setCaptureMode,
    setBubbleStyle,
    setBubblePosition,
    setCountdownDuration,
    setSensitiveFilterEnabled,
    defaultAction,
    setDefaultAction,
    setUrlReadingEnabled,
    setRadarIntervalDays,
    loadXReaderStatus,
  } = useSettingsStore();

  const [showApiKey, setShowApiKey] = useState(false);
  const [draftApiKey, setDraftApiKey] = useState<string | null>(null);
  const [apiKeySaved, setApiKeySaved] = useState(false);
  const [testStatus, setTestStatus] = useState<"idle" | "testing" | "success" | "error">("idle");
  const [testMessage, setTestMessage] = useState("");
  // MCP connection state per target
  type McpTargetId = "claude" | "openclaw";
  interface McpTargetState {
    connected: boolean;
    loading: boolean;
    message: string | null;
    error: string | null;
  }
  const [mcpStates, setMcpStates] = useState<Record<McpTargetId, McpTargetState>>({
    claude: { connected: false, loading: false, message: null, error: null },
    openclaw: { connected: false, loading: false, message: null, error: null },
  });
  const [summaryCopied, setSummaryCopied] = useState(false);
  const [mcpGlobalError, setMcpGlobalError] = useState<string | null>(null);

  const updateMcpTarget = (id: McpTargetId, update: Partial<McpTargetState>) => {
    setMcpStates((prev) => ({ ...prev, [id]: { ...prev[id], ...update } }));
  };

  const loadMcpStatus = useCallback(async () => {
    for (const target of ["claude", "openclaw"] as McpTargetId[]) {
      try {
        const status = await invoke<{ connected: boolean }>("get_mcp_status", { target });
        updateMcpTarget(target, { connected: status.connected });
      } catch {
        // silently fail — target may not be installed
      }
    }
  }, []);

  useEffect(() => {
    loadMcpStatus();
  }, [loadMcpStatus]);

  const handleConnectMcp = async (target: McpTargetId) => {
    console.log("[MCP] connect clicked, target:", target);
    updateMcpTarget(target, { loading: true, error: null, message: null });
    try {
      const msg = await invoke<string>("connect_mcp", { target });
      console.log("[MCP] connect success:", msg);
      updateMcpTarget(target, { loading: false, message: msg, connected: true });
    } catch (e) {
      const errMsg = typeof e === "string" ? e : String(e);
      console.error("[MCP] connect error:", errMsg);
      updateMcpTarget(target, { loading: false, error: errMsg });
    }
  };

  const handleDisconnectMcp = async (target: McpTargetId) => {
    updateMcpTarget(target, { loading: true, error: null, message: null });
    try {
      await invoke("disconnect_mcp", { target });
      updateMcpTarget(target, { loading: false, connected: false, message: "已断开连接。" });
    } catch (e) {
      updateMcpTarget(target, { loading: false, error: typeof e === "string" ? e : String(e) });
    }
  };

  const handleCopySummary = async () => {
    setMcpGlobalError(null);
    try {
      const summary = await invoke<string>("copy_content_summary");
      await navigator.clipboard.writeText(summary);
      setSummaryCopied(true);
      setTimeout(() => setSummaryCopied(false), 2000);
    } catch (e) {
      setMcpGlobalError(typeof e === "string" ? e : String(e));
    }
  };

  const availableModels = MODELS_BY_PROVIDER[provider];

  const { setStorageInfo } = useSettingsStore();

  useEffect(() => {
    loadXReaderStatus();
    // Load storage info
    invoke<{ total_items: number; disk_usage_mb: number }>("get_storage_info")
      .then((info) => setStorageInfo(info.total_items, info.disk_usage_mb))
      .catch(() => {});
  }, [loadXReaderStatus, setStorageInfo]);

  const categories = [
    { id: "appearance", label: "外观", icon: Palette },
    { id: "capture", label: "采集", icon: Camera },
    { id: "radar", label: "雷达", icon: Target },
    { id: "ai", label: "AI", icon: Bot },
    { id: "connect", label: "连接", icon: LinkIcon },
    { id: "storage", label: "存储", icon: HardDrive },
  ];
  const [activeCategory, setActiveCategory] = useState("appearance");

  return (
    <div className="flex" style={{ height: "calc(100vh - 44px)" }}>
      {/* Left: category nav */}
      <div
        className="w-36 shrink-0 px-2 overflow-y-auto border-r flex flex-col"
        style={{ borderColor: "var(--color-border, #e5e5e5)" }}
      >
        <div className="flex-1 pt-2">
          {categories.map((cat) => {
            const Icon = cat.icon;
            const isActive = activeCategory === cat.id;
            return (
              <button
                key={cat.id}
                onClick={() => setActiveCategory(cat.id)}
                className={`
                  w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium mb-1 transition-colors
                  ${isActive
                    ? "bg-orange-500/10 dark:bg-orange-500/15 text-orange-600 dark:text-orange-400"
                    : "text-gray-600 dark:text-gray-400 hover:bg-gray-100/50 dark:hover:bg-white/[0.04]"
                  }
                `}
              >
                <Icon size={16} strokeWidth={2} />
                {cat.label}
              </button>
            );
          })}
        </div>
        <div className="py-3 px-3">
          <p className="text-[10px] text-gray-400 dark:text-gray-600">小云 v0.1.0</p>
        </div>
      </div>

      {/* Right: settings content */}
      <div className="flex-1 overflow-y-auto p-6 flex justify-center">
        <div className="w-full max-w-xl">

      {/* ===== 外观 ===== */}
      {activeCategory === "appearance" && (
        <div className="space-y-6">
          <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-100">外观</h2>
          <div className="glass rounded-2xl">
            <div className="p-4">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                主题模式
              </label>
              <div className="flex gap-2">
                {THEME_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setTheme(opt.value)}
                    className={`
                      flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 text-sm font-medium rounded-lg border transition-all duration-150
                      ${theme === opt.value
                        ? "bg-orange-500/10 dark:bg-orange-500/15 border-orange-300/60 dark:border-orange-500/30 text-orange-700 dark:text-orange-400 shadow-sm"
                        : "bg-white/50 dark:bg-white/[0.04] border-white/60 dark:border-white/[0.08] text-gray-600 dark:text-slate-300 hover:bg-white/80 dark:hover:bg-white/[0.08]"
                      }
                    `}
                  >
                    <span>{opt.icon}</span>
                    <span>{opt.label}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ===== 采集 ===== */}
      {activeCategory === "capture" && (
        <div className="space-y-1">
          <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-100 mb-4">采集</h2>
          <div className="glass rounded-2xl divide-y divide-gray-100/50 dark:divide-white/[0.06]">

          {/* Capture Toggle */}
          <SettingRow label="内容捕获" desc="开启后将自动检测剪贴板和截图变化">
            <ToggleSwitch checked={captureEnabled} onChange={setCaptureEnabled} color="orange" />
          </SettingRow>

          {/* Capture Mode */}
          <SettingRow label="捕获模式" desc="自动保存所有内容，或逐个确认">
            <div className="flex gap-1.5">
              {([
                { value: "confirm", label: "确认" },
                { value: "auto", label: "自动" },
              ] as const).map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setCaptureMode(opt.value)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors
                    ${captureMode === opt.value
                      ? "bg-orange-500/10 dark:bg-orange-500/15 border-orange-300/60 dark:border-orange-500/30 text-orange-700 dark:text-orange-400"
                      : "bg-white/50 dark:bg-white/[0.04] border-gray-200/50 dark:border-white/[0.08] text-gray-600 dark:text-slate-300"
                    }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </SettingRow>

          {/* Default Action */}
          {captureMode === "confirm" && (
            <SettingRow label="默认操作" desc="确认弹窗倒计时结束后的默认行为">
              <div className="flex gap-1.5">
                {([
                  { value: "dismiss", label: "丢弃" },
                  { value: "save", label: "保存" },
                ] as const).map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setDefaultAction(opt.value)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors
                      ${defaultAction === opt.value
                        ? "bg-orange-500/10 dark:bg-orange-500/15 border-orange-300/60 dark:border-orange-500/30 text-orange-700 dark:text-orange-400"
                        : "bg-white/50 dark:bg-white/[0.04] border-gray-200/50 dark:border-white/[0.08] text-gray-600 dark:text-slate-300"
                      }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </SettingRow>
          )}

          {/* Bubble Style */}
          {captureMode === "confirm" && (
            <SettingRow label="悬浮球样式">
              <div className="flex gap-1.5">
                {([
                  { value: "circle", label: "圆形" },
                  { value: "bar", label: "长条" },
                ] as const).map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setBubbleStyle(opt.value)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors
                      ${bubbleStyle === opt.value
                        ? "bg-orange-500/10 dark:bg-orange-500/15 border-orange-300/60 dark:border-orange-500/30 text-orange-700 dark:text-orange-400"
                        : "bg-white/50 dark:bg-white/[0.04] border-gray-200/50 dark:border-white/[0.08] text-gray-600 dark:text-slate-300"
                      }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </SettingRow>
          )}

          {/* Bubble Position */}
          {captureMode === "confirm" && (
            <SettingRow label="悬浮球位置">
              <select
                value={bubblePosition}
                onChange={(e) => setBubblePosition(e.target.value as BubblePosition)}
                className="text-sm rounded-lg px-3 py-1.5 bg-white/40 dark:bg-white/[0.06] border border-gray-200/50 dark:border-white/[0.08] text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-1 focus:ring-orange-400/50"
              >
                {BUBBLE_POSITION_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.icon} {opt.label}</option>
                ))}
              </select>
            </SettingRow>
          )}

          {/* Countdown */}
          {captureMode === "confirm" && (
            <SettingRow label="确认倒计时" desc="悬浮球自动消失的等待时间">
              <select
                value={countdownDuration}
                onChange={(e) => setCountdownDuration(Number(e.target.value))}
                className="text-sm rounded-lg px-3 py-1.5 bg-white/40 dark:bg-white/[0.06] border border-gray-200/50 dark:border-white/[0.08] text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-1 focus:ring-orange-400/50"
              >
                {[3, 5, 8, 10, 15].map((s) => (
                  <option key={s} value={s}>{s} 秒</option>
                ))}
              </select>
            </SettingRow>
          )}

          {/* Sensitive Filter */}
          <SettingRow label="敏感数据过滤" desc="自动过滤密码、私钥、API Key 等">
            <ToggleSwitch checked={sensitiveFilterEnabled} onChange={setSensitiveFilterEnabled} color="amber" />
          </SettingRow>

          {/* URL Reading */}
          <SettingRow label="链接内容读取" desc="复制链接时自动获取网页正文">
            <ToggleSwitch checked={urlReadingEnabled} onChange={setUrlReadingEnabled} color="green" />
          </SettingRow>

          </div>
        </div>
      )}

      {/* ===== 雷达 ===== */}
      {activeCategory === "radar" && (
        <div className="space-y-1">
          <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-100 mb-4">雷达</h2>
          <div className="glass rounded-2xl divide-y divide-gray-100/50 dark:divide-white/[0.06]">
            <SettingRow label="分析频率" desc="注意力雷达自动分析的间隔时间">
              <select
                value={radarIntervalDays}
                onChange={(e) => setRadarIntervalDays(Number(e.target.value))}
                className="text-sm rounded-lg px-3 py-1.5 bg-white/40 dark:bg-white/[0.06] border border-gray-200/50 dark:border-white/[0.08] text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-1 focus:ring-orange-400/50"
              >
                <option value={1}>每天</option>
                <option value={3}>每 3 天</option>
                <option value={7}>每周</option>
                <option value={30}>每月</option>
              </select>
            </SettingRow>
          </div>
          <p className="text-xs text-gray-400 dark:text-gray-600 mt-3 px-1">
            雷达页右上角的刷新按钮可以随时手动触发分析
          </p>
        </div>
      )}

      {/* ===== AI ===== */}
      {activeCategory === "ai" && (
        <div className="space-y-1">
          <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-100 mb-4">AI 配置</h2>
          <div className="glass rounded-2xl divide-y divide-gray-100/50 dark:divide-white/[0.06]">

          {/* Provider */}
          <SettingRow label="AI 提供商">
            <select
              value={provider}
              onChange={(e) => {
                setProvider(e.target.value as AIProvider);
                setDraftApiKey(null);
                setTestStatus("idle");
                setTestMessage("");
                setApiKeySaved(false);
              }}
              className="text-sm rounded-lg px-3 py-1.5 bg-white/40 dark:bg-white/[0.06] border border-gray-200/50 dark:border-white/[0.08] text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-1 focus:ring-orange-400/50"
            >
              {(Object.entries(PROVIDER_LABELS) as [AIProvider, string][]).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </SettingRow>

          {/* Model */}
          <SettingRow label="模型">
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="text-sm rounded-lg px-3 py-1.5 bg-white/40 dark:bg-white/[0.06] border border-gray-200/50 dark:border-white/[0.08] text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-1 focus:ring-orange-400/50 max-w-[220px]"
            >
              {MODELS_BY_PROVIDER[provider].map((m) => (
                <option key={m.id} value={m.id}>
                  {m.free ? "🆓 " : ""}{m.label}
                </option>
              ))}
            </select>
          </SettingRow>

          {/* API Key */}
          <div className="p-4">
            <div className="flex items-center justify-between mb-2">
              <div>
                <div className="text-sm font-medium text-gray-700 dark:text-gray-300">API Key</div>
                <div className="text-xs text-gray-400 dark:text-slate-500 mt-0.5">安全存储在本地</div>
              </div>
            </div>
            <div className="flex gap-2">
              <input
                type={showApiKey ? "text" : "password"}
                value={draftApiKey ?? apiKey}
                onChange={(e) => {
                  setDraftApiKey(e.target.value);
                  setApiKeySaved(false);
                  setTestStatus("idle");
                }}
                placeholder="输入你的 API Key"
                className="flex-1 px-3 py-2 text-sm rounded-lg bg-white/50 dark:bg-white/[0.04] border border-gray-200/50 dark:border-white/[0.08] text-gray-800 dark:text-gray-200 placeholder-gray-400 dark:placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-orange-400/50"
              />
              <button
                onClick={() => setShowApiKey(!showApiKey)}
                className="px-3 py-2 text-xs font-medium rounded-lg border border-gray-200/50 dark:border-white/[0.08] text-gray-500 dark:text-slate-400 hover:bg-gray-100/50 dark:hover:bg-white/[0.04] transition-colors"
              >
                {showApiKey ? "隐藏" : "显示"}
              </button>
            </div>
            <div className="flex gap-2 mt-2">
              <button
                onClick={() => {
                  const key = draftApiKey ?? apiKey;
                  setApiKey(key);
                  setDraftApiKey(null);
                  setApiKeySaved(true);
                  setTimeout(() => setApiKeySaved(false), 2000);
                }}
                disabled={draftApiKey === null || draftApiKey === apiKey}
                className="px-4 py-1.5 text-xs font-medium rounded-lg border transition-colors
                  disabled:opacity-30 disabled:cursor-default
                  bg-orange-500/10 dark:bg-orange-500/15 border-orange-300/60 dark:border-orange-500/30 text-orange-700 dark:text-orange-400 hover:bg-orange-500/20 dark:hover:bg-orange-500/25"
              >
                {apiKeySaved ? "✓ 已保存" : "保存"}
              </button>
              <button
                onClick={async () => {
                  const key = draftApiKey ?? apiKey;
                  if (!key) return;
                  // Save first if draft exists
                  if (draftApiKey !== null && draftApiKey !== apiKey) {
                    setApiKey(draftApiKey);
                    setDraftApiKey(null);
                  }
                  setTestStatus("testing");
                  setTestMessage("");
                  try {
                    const result = await invoke<string>("test_ai_connection", {
                      provider, model, apiKey: key,
                    });
                    setTestStatus("success");
                    setTestMessage(result);
                  } catch (e) {
                    setTestStatus("error");
                    setTestMessage(typeof e === "string" ? e : String(e));
                  }
                }}
                disabled={!(draftApiKey ?? apiKey) || testStatus === "testing"}
                className="px-4 py-1.5 text-xs font-medium rounded-lg border transition-colors
                  disabled:opacity-30 disabled:cursor-default
                  bg-white/50 dark:bg-white/[0.04] border-gray-200/50 dark:border-white/[0.08] text-gray-600 dark:text-slate-300 hover:bg-white/80 dark:hover:bg-white/[0.08]"
              >
                {testStatus === "testing" ? "测试中..." : "测试连接"}
              </button>
            </div>
            {testStatus === "success" && (
              <p className="mt-2 text-xs text-green-600 dark:text-green-400">✓ 连接成功：{testMessage}</p>
            )}
            {testStatus === "error" && (
              <p className="mt-2 text-xs text-red-500 dark:text-red-400">✗ {testMessage}</p>
            )}
          </div>

          </div>
        </div>
      )}

      {/* ===== 连接 ===== */}
      {activeCategory === "connect" && (
        <div className="space-y-1">
          <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-100 mb-4">AI 助理连接</h2>
          <div className="glass rounded-2xl divide-y divide-gray-100/50 dark:divide-white/[0.06]">
          {([
            { id: "claude" as McpTargetId, name: "Claude Desktop", hint: "在 Claude 中问" },
          ]).map((t) => {
            const s = mcpStates[t.id];
            return (
              <div key={t.id} className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <div className="text-sm font-medium text-gray-700 dark:text-gray-300">
                      {t.name}
                    </div>
                    <div className="text-xs text-gray-400 dark:text-slate-500 mt-0.5">
                      {s.connected
                        ? `已连接 — ${t.name} 可以读取你保存的内容`
                        : `一键让 ${t.name} 读取你的数据`}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${s.connected ? "bg-green-500" : "bg-gray-300 dark:bg-slate-600"}`} />
                    <span className="text-xs text-gray-500 dark:text-slate-400">
                      {s.connected ? "已连接" : "未连接"}
                    </span>
                  </div>
                </div>

                {s.connected ? (
                  <button
                    onClick={() => handleDisconnectMcp(t.id)}
                    disabled={s.loading}
                    className="w-full py-2 text-sm font-medium rounded-lg border text-red-500 dark:text-red-400 border-red-200/50 dark:border-red-500/20 bg-red-50/50 dark:bg-red-500/[0.06] hover:bg-red-100/50 dark:hover:bg-red-500/[0.12] disabled:opacity-50 transition-colors"
                  >
                    {s.loading ? "处理中..." : "断开连接"}
                  </button>
                ) : (
                  <button
                    onClick={() => handleConnectMcp(t.id)}
                    disabled={s.loading}
                    className="w-full py-2 text-sm font-medium rounded-lg border text-orange-600 dark:text-orange-400 border-orange-200/50 dark:border-orange-500/20 bg-orange-50/50 dark:bg-orange-500/[0.06] hover:bg-orange-100/50 dark:hover:bg-orange-500/[0.12] disabled:opacity-50 transition-colors"
                  >
                    {s.loading ? "连接中..." : `连接 ${t.name}`}
                  </button>
                )}

                {s.message && <p className="mt-2 text-xs text-green-600 dark:text-green-400">{s.message}</p>}
                {s.error && <p className="mt-2 text-xs text-red-500 dark:text-red-400">{s.error}</p>}
              </div>
            );
          })}

          {/* Copy Summary */}
          <div className="p-4">
            <div className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              内容摘要
            </div>
            <div className="text-xs text-gray-400 dark:text-slate-500 mb-3">
              复制最近 7 天的内容摘要，粘贴给 AI 助理
            </div>
            <button
              onClick={async () => {
                try {
                  await invoke("copy_content_summary");
                  setSummaryCopied(true);
                  setTimeout(() => setSummaryCopied(false), 3000);
                } catch (e) {
                  setMcpGlobalError(typeof e === "string" ? e : String(e));
                }
              }}
              className="w-full py-2 text-sm font-medium rounded-lg border text-gray-600 dark:text-gray-300 border-gray-200/50 dark:border-white/[0.08] bg-white/40 dark:bg-white/[0.04] hover:bg-white/70 dark:hover:bg-white/[0.08] transition-colors"
            >
              {summaryCopied ? "✓ 已复制到剪贴板" : "复制最近内容摘要"}
            </button>
            {mcpGlobalError && <p className="mt-2 text-xs text-red-500 dark:text-red-400">{mcpGlobalError}</p>}
          </div>
          </div>
        </div>
      )}

      {/* ===== 存储 ===== */}
      {activeCategory === "storage" && (
        <div className="space-y-1">
          <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-100 mb-4">存储</h2>
          <div className="glass rounded-2xl divide-y divide-gray-100/50 dark:divide-white/[0.06]">
            <SettingRow label="已保存内容">
              <span className="text-sm font-mono text-gray-700 dark:text-gray-300">{totalItems} 条</span>
            </SettingRow>
            <SettingRow label="磁盘占用">
              <span className="text-sm font-mono text-gray-700 dark:text-gray-300">{diskUsageMB.toFixed(1)} MB</span>
            </SettingRow>
            <SettingRow label="截图目录">
              <span className="text-xs font-mono text-gray-500 dark:text-slate-400 break-all">{screenshotDir}</span>
            </SettingRow>
            <div className="p-4">
              <button
                onClick={() => invoke("open_data_folder").catch((e) => console.error("open_data_folder failed:", e))}
                className="w-full py-2 text-sm font-medium rounded-lg border text-gray-600 dark:text-gray-300 border-gray-200/50 dark:border-white/[0.08] bg-white/40 dark:bg-white/[0.04] hover:bg-white/70 dark:hover:bg-white/[0.08] transition-colors"
              >
                打开数据文件夹
              </button>
            </div>
          </div>

          {/* Export section */}
          <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-100 mb-4 mt-6">导出</h2>
          <ExportSection totalItems={totalItems} />
        </div>
      )}

        </div>
      </div>
    </div>
  );
}

{/* ===== Reusable setting row component ===== */}
function SettingRow({ label, desc, children }: { label: string; desc?: string; children: React.ReactNode }) {
  return (
    <div className="p-4 flex items-center justify-between gap-4">
      <div className="min-w-0">
        <div className="text-sm font-medium text-gray-700 dark:text-gray-300">{label}</div>
        {desc && <div className="text-xs text-gray-400 dark:text-slate-500 mt-0.5">{desc}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function ToggleSwitch({ checked, onChange, color = "orange" }: { checked: boolean; onChange: (v: boolean) => void; color?: string }) {
  const bgColor = checked
    ? color === "amber" ? "bg-amber-500"
    : color === "green" ? "bg-green-500"
    : "bg-orange-500"
    : "bg-gray-300 dark:bg-slate-600";

  return (
    <button
      onClick={() => onChange(!checked)}
      className={`relative w-11 h-6 rounded-full transition-colors duration-200 shrink-0 ${bgColor}`}
    >
      <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform duration-200 ${checked ? "translate-x-5" : "translate-x-0"}`} />
    </button>
  );
}

function ExportSection({ totalItems }: { totalItems: number }) {
  const [exportStatus, setExportStatus] = useState<"idle" | "exporting" | "done">("idle");
  const [resultMsg, setResultMsg] = useState("");
  const [rangeOpen, setRangeOpen] = useState(false);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const handleExportAll = async () => {
    setExportStatus("exporting");
    try {
      await invoke("export_all_single");
      setResultMsg(`已导出 ${totalItems} 条内容`);
      setExportStatus("done");
      setTimeout(() => setExportStatus("idle"), 3000);
    } catch (e) {
      console.error(e);
      setExportStatus("idle");
    }
  };

  const handleExportRange = async () => {
    if (!startDate || !endDate) return;
    setExportStatus("exporting");
    try {
      await invoke("export_range_single", { start: startDate, end: endDate });
      setResultMsg(`已导出 ${startDate} 至 ${endDate}`);
      setExportStatus("done");
      setRangeOpen(false);
      setTimeout(() => setExportStatus("idle"), 3000);
    } catch (e) {
      console.error(e);
      setExportStatus("idle");
    }
  };

  return (
    <div className="glass rounded-2xl divide-y divide-gray-100/50 dark:divide-white/[0.06]">
      {/* Export all */}
      <div className="p-4">
        <div className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">导出全部内容</div>
        <div className="text-xs text-gray-400 dark:text-slate-500 mb-3">
          {totalItems} 条内容导出为单个 Markdown 文件，保存到下载文件夹
        </div>
        <button
          onClick={handleExportAll}
          disabled={exportStatus === "exporting"}
          className="w-full py-2 text-sm font-medium rounded-lg border
                     text-orange-600 dark:text-orange-400 border-orange-200/50 dark:border-orange-500/20
                     bg-orange-50/50 dark:bg-orange-500/[0.06]
                     hover:bg-orange-100/50 dark:hover:bg-orange-500/[0.12]
                     disabled:opacity-50 transition-colors"
        >
          {exportStatus === "exporting" ? "导出中..." : "导出全部"}
        </button>
      </div>

      {/* Export date range */}
      <div className="p-4">
        <div className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">按日期范围导出</div>
        <div className="text-xs text-gray-400 dark:text-slate-500 mb-3">
          选择起止日期，导出为单个 Markdown 文件
        </div>
        {!rangeOpen ? (
          <button
            onClick={() => {
              setRangeOpen(true);
              if (!startDate) {
                const end = new Date();
                const start = new Date();
                start.setDate(end.getDate() - 7);
                setStartDate(start.toISOString().slice(0, 10));
                setEndDate(end.toISOString().slice(0, 10));
              }
            }}
            className="w-full py-2 text-sm font-medium rounded-lg border
                       text-gray-600 dark:text-gray-300 border-gray-200/50 dark:border-white/[0.08]
                       bg-white/40 dark:bg-white/[0.04]
                       hover:bg-white/70 dark:hover:bg-white/[0.08] transition-colors"
          >
            选择日期范围
          </button>
        ) : (
          <div className="space-y-2.5">
            <div>
              <div className="text-xs text-gray-500 dark:text-slate-400 mb-1">开始日期</div>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full text-sm px-3 py-1.5 rounded-lg border border-gray-200/50 dark:border-white/[0.08]
                           bg-white/50 dark:bg-white/[0.04] text-gray-800 dark:text-gray-200
                           focus:outline-none focus:ring-1 focus:ring-orange-400/50"
              />
            </div>
            <div>
              <div className="text-xs text-gray-500 dark:text-slate-400 mb-1">结束日期</div>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full text-sm px-3 py-1.5 rounded-lg border border-gray-200/50 dark:border-white/[0.08]
                           bg-white/50 dark:bg-white/[0.04] text-gray-800 dark:text-gray-200
                           focus:outline-none focus:ring-1 focus:ring-orange-400/50"
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setRangeOpen(false)}
                className="flex-1 py-1.5 text-sm font-medium rounded-lg border
                           text-gray-500 dark:text-slate-400 border-gray-200/50 dark:border-white/[0.08]
                           bg-white/40 dark:bg-white/[0.04] hover:bg-white/70 dark:hover:bg-white/[0.08] transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleExportRange}
                disabled={!startDate || !endDate || exportStatus === "exporting"}
                className="flex-1 py-1.5 text-sm font-medium rounded-lg border
                           text-orange-600 dark:text-orange-400 border-orange-200/50 dark:border-orange-500/20
                           bg-orange-50/50 dark:bg-orange-500/[0.06]
                           hover:bg-orange-100/50 dark:hover:bg-orange-500/[0.12]
                           disabled:opacity-50 transition-colors"
              >
                {exportStatus === "exporting" ? "导出中..." : "确认导出"}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Result toast */}
      {exportStatus === "done" && (
        <div className="p-4">
          <div className="px-3 py-2 rounded-lg bg-green-500/10 dark:bg-green-500/15 border border-green-300/40 dark:border-green-500/20">
            <p className="text-xs text-green-700 dark:text-green-400 text-center">
              ✓ {resultMsg}，已在 Finder 中打开
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
