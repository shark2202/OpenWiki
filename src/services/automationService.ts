import { invoke } from "@tauri-apps/api/core";

/**
 * macOS Automation (Apple Events) permission lifecycle.
 *
 * Backend: src-tauri/src/automation/mod.rs
 */

export type AutomationStatus =
  | "unknown"
  | "granted"
  | "denied"
  | "dismissed";

export interface AutomationSnapshot {
  status: AutomationStatus;
  initial_prompt_shown: boolean;
}

/** Read the persisted snapshot (no system side effects). */
export async function getAutomationStatus(): Promise<AutomationSnapshot> {
  return invoke("get_automation_status");
}

/**
 * Run the probe osascript — will pop the macOS system dialog on first
 * call, succeed silently if already granted, or fail if previously denied.
 * Persists the outcome and returns the updated snapshot.
 */
export async function requestAutomationPermission(): Promise<AutomationSnapshot> {
  return invoke("request_automation_permission");
}

/** The user clicked "稍后再说" — mark as dismissed, don't touch the system. */
export async function dismissAutomationPrompt(): Promise<void> {
  return invoke("dismiss_automation_prompt");
}

/** Deep-link into System Settings → Privacy & Security → Automation. */
export async function openAutomationSettings(): Promise<void> {
  return invoke("open_automation_settings");
}
