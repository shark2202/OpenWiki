use std::path::PathBuf;
use std::process::Command;
use std::sync::OnceLock;

/// Path to the pre-compiled OCR helper binary, resolved at app startup
/// from the Tauri resource directory. See `lib.rs` setup hook.
static OCR_BINARY_PATH: OnceLock<PathBuf> = OnceLock::new();

/// Register the OCR helper binary path. Called once from the Tauri setup hook
/// with the resource directory resolved via `AppHandle::path().resource_dir()`.
pub fn init_ocr_binary_path(path: PathBuf) {
    let _ = OCR_BINARY_PATH.set(path);
}

/// Locate the OCR helper binary.
///
/// Normally this just returns the path registered at startup, but it also
/// falls back to searching next to the current executable so things keep
/// working in cargo tests and unusual launch contexts.
fn resolve_ocr_binary() -> Result<PathBuf, String> {
    if let Some(p) = OCR_BINARY_PATH.get() {
        if p.exists() {
            return Ok(p.clone());
        }
    }

    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            let candidates = [
                parent.join("openwiki_ocr_bin"),
                parent.join("../Resources/openwiki_ocr_bin"),
                parent.join("../Resources/resources/openwiki_ocr_bin"),
            ];
            for c in candidates.iter() {
                if c.exists() {
                    return Ok(c.clone());
                }
            }
        }
    }

    if let Ok(manifest_dir) = std::env::var("CARGO_MANIFEST_DIR") {
        let candidate = PathBuf::from(manifest_dir).join("resources/openwiki_ocr_bin");
        if candidate.exists() {
            return Ok(candidate);
        }
    }

    if let Ok(current_dir) = std::env::current_dir() {
        for candidate in [
            current_dir.join("resources/openwiki_ocr_bin"),
            current_dir.join("src-tauri/resources/openwiki_ocr_bin"),
        ] {
            if candidate.exists() {
                return Ok(candidate);
            }
        }
    }

    Err("OCR helper binary not found — the app bundle may be corrupted.".to_string())
}

/// Perform OCR on an image file using macOS Vision framework.
/// Returns the recognized text, supporting Chinese + English.
///
/// The helper binary is pre-compiled at build time and shipped inside the
/// app bundle, so end users do NOT need to install Xcode Command Line Tools.
pub fn recognize_text(image_path: &str) -> Result<String, String> {
    let binary_path = resolve_ocr_binary()?;

    let output = Command::new(&binary_path)
        .arg(image_path)
        .output()
        .map_err(|e| format!("Failed to run OCR: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("OCR failed: {}", stderr.trim()));
    }

    let text = String::from_utf8_lossy(&output.stdout).trim().to_string();

    if text.is_empty() {
        return Err("未识别到文字内容".to_string());
    }

    log::info!("[OCR] 识别完成: {} chars from {}", text.len(), image_path);
    Ok(text)
}
