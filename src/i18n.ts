import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";

// zh-CN
import zhCommon from "./locales/zh-CN/common.json";
import zhSettings from "./locales/zh-CN/settings.json";
import zhContent from "./locales/zh-CN/content.json";
import zhWiki from "./locales/zh-CN/wiki.json";
import zhDigest from "./locales/zh-CN/digest.json";
import zhReport from "./locales/zh-CN/report.json";
import zhDataHub from "./locales/zh-CN/dataHub.json";
import zhUpdate from "./locales/zh-CN/update.json";
import zhAutomation from "./locales/zh-CN/automation.json";

// en-US
import enCommon from "./locales/en-US/common.json";
import enSettings from "./locales/en-US/settings.json";
import enContent from "./locales/en-US/content.json";
import enWiki from "./locales/en-US/wiki.json";
import enDigest from "./locales/en-US/digest.json";
import enReport from "./locales/en-US/report.json";
import enDataHub from "./locales/en-US/dataHub.json";
import enUpdate from "./locales/en-US/update.json";
import enAutomation from "./locales/en-US/automation.json";

const resources = {
  "zh-CN": {
    common: zhCommon,
    settings: zhSettings,
    content: zhContent,
    wiki: zhWiki,
    digest: zhDigest,
    report: zhReport,
    dataHub: zhDataHub,
    update: zhUpdate,
    automation: zhAutomation,
  },
  "en-US": {
    common: enCommon,
    settings: enSettings,
    content: enContent,
    wiki: enWiki,
    digest: enDigest,
    report: enReport,
    dataHub: enDataHub,
    update: enUpdate,
    automation: enAutomation,
  },
};

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: "zh-CN",
    defaultNS: "common",
    ns: ["common", "settings", "content", "wiki", "digest", "report", "dataHub", "update", "automation"],
    interpolation: {
      escapeValue: false,
    },
    detection: {
      order: ["localStorage", "navigator"],
      lookupLocalStorage: "openwiki_language",
      caches: ["localStorage"],
    },
  });

/**
 * Set the app language. Called from settingsStore when user changes language.
 * Also updates <html lang> and persists to localStorage for i18next detector.
 */
export function setAppLanguage(lang: string) {
  const resolved = lang === "system" ? getSystemLanguage() : lang;
  i18n.changeLanguage(resolved);
  document.documentElement.lang = resolved;
  // Persist the user's mode choice (not the resolved value)
  localStorage.setItem("openwiki_language_mode", lang);
  // Persist the resolved value for i18next detector on next boot
  localStorage.setItem("openwiki_language", resolved);
}

/**
 * Get the system language, mapped to our supported locales.
 */
export function getSystemLanguage(): string {
  const nav = navigator.language || "zh-CN";
  if (nav.startsWith("zh")) return "zh-CN";
  return "en-US";
}

/**
 * Initialize language from saved settings.
 * Called once during app startup after settings are loaded from DB.
 */
export function initLanguageFromSettings(languageMode: string) {
  const resolved = languageMode === "system" ? getSystemLanguage() : languageMode;
  if (i18n.language !== resolved) {
    i18n.changeLanguage(resolved);
  }
  document.documentElement.lang = resolved;
}

export default i18n;
