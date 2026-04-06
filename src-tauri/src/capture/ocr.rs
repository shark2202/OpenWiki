use std::path::PathBuf;
use std::process::Command;
use std::sync::Once;

static COMPILE_ONCE: Once = Once::new();

/// Get the path to the compiled OCR binary.
/// The binary is cached in the system temp directory.
fn get_ocr_binary_path() -> PathBuf {
    std::env::temp_dir().join("xiaoyun_ocr_bin")
}

/// Ensure the OCR Swift tool is compiled (only compiles once per session).
fn ensure_compiled() -> Result<(), String> {
    let binary_path = get_ocr_binary_path();
    let script_path = std::env::temp_dir().join("xiaoyun_ocr.swift");

    // Check if binary exists and matches current version
    // We embed a version marker in the script to detect changes
    let version_marker = "xiaoyun_ocr_v3_tiled";
    let version_file = std::env::temp_dir().join("xiaoyun_ocr_version");
    let current_version = std::fs::read_to_string(&version_file).unwrap_or_default();

    if binary_path.exists() && current_version.trim() == version_marker {
        if let Ok(meta) = std::fs::metadata(&binary_path) {
            if let Ok(modified) = meta.modified() {
                if modified.elapsed().unwrap_or_default().as_secs() < 86400 {
                    return Ok(());
                }
            }
        }
    }

    let swift_code = r#"
import Vision
import Foundation
import CoreGraphics

let args = CommandLine.arguments
guard args.count > 1 else {
    fputs("Usage: ocr <image_path>\n", stderr)
    exit(1)
}
let imagePath = args[1]
let imageURL = URL(fileURLWithPath: imagePath)

guard let imageSource = CGImageSourceCreateWithURL(imageURL as CFURL, nil),
      let cgImage = CGImageSourceCreateImageAtIndex(imageSource, 0, nil) else {
    fputs("Cannot load image: \(imagePath)\n", stderr)
    exit(1)
}

/// OCR a single CGImage tile and return recognized lines
func ocrTile(_ tile: CGImage) -> [String] {
    let semaphore = DispatchSemaphore(value: 0)
    var lines: [String] = []

    let request = VNRecognizeTextRequest { request, error in
        if let observations = request.results as? [VNRecognizedTextObservation] {
            lines = observations.compactMap { $0.topCandidates(1).first?.string }
        }
        semaphore.signal()
    }
    request.recognitionLevel = .accurate
    request.recognitionLanguages = ["zh-Hans", "zh-Hant", "en-US"]
    request.usesLanguageCorrection = true

    let handler = VNImageRequestHandler(cgImage: tile, options: [:])
    do {
        try handler.perform([request])
    } catch {
        fputs("Vision error: \(error.localizedDescription)\n", stderr)
        semaphore.signal()
    }
    semaphore.wait()
    return lines
}

let width = cgImage.width
let height = cgImage.height
let maxTileHeight = 2000  // Split images taller than 2000px into tiles

var allLines: [String] = []

if height <= maxTileHeight {
    // Small image: OCR directly
    allLines = ocrTile(cgImage)
} else {
    // Long image: split into overlapping tiles for better accuracy
    let overlap = 100  // Overlap to avoid cutting text at boundaries
    var y = 0
    while y < height {
        let tileH = min(maxTileHeight, height - y)
        let rect = CGRect(x: 0, y: y, width: width, height: tileH)
        if let tile = cgImage.cropping(to: rect) {
            let tileLines = ocrTile(tile)
            // Deduplicate: skip lines that match the last line from previous tile (overlap region)
            if !allLines.isEmpty && !tileLines.isEmpty {
                // Find where overlap starts — skip duplicate lines
                var startIdx = 0
                for i in 0..<min(5, tileLines.count) {
                    if allLines.last == tileLines[i] {
                        startIdx = i + 1
                        break
                    }
                }
                allLines.append(contentsOf: tileLines[startIdx...])
            } else {
                allLines.append(contentsOf: tileLines)
            }
        }
        y += tileH - overlap
        if tileH < maxTileHeight { break }
    }
}

let resultText = allLines.joined(separator: "\n")
print(resultText)
"#;

    // Write script
    std::fs::write(&script_path, swift_code)
        .map_err(|e| format!("Failed to write OCR script: {}", e))?;

    // Compile to binary
    log::info!("[OCR] Compiling Swift OCR tool...");
    let output = Command::new("/usr/bin/swiftc")
        .args([
            "-O", // optimize
            script_path.to_str().unwrap(),
            "-o",
            binary_path.to_str().unwrap(),
        ])
        .output()
        .map_err(|e| format!("Failed to compile OCR: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("OCR compile failed: {}", stderr.trim()));
    }

    // Write version marker so we know the binary matches current code
    let _ = std::fs::write(&version_file, version_marker);
    log::info!(
        "[OCR] Swift OCR tool compiled successfully ({})",
        version_marker
    );
    Ok(())
}

/// Perform OCR on an image file using macOS Vision framework.
/// Returns the recognized text, supporting Chinese + English.
///
/// First call compiles a Swift binary (cached for 24 hours).
/// Subsequent calls run the pre-compiled binary (~1s per image).
pub fn recognize_text(image_path: &str) -> Result<String, String> {
    // Ensure the binary is compiled
    ensure_compiled()?;

    let binary_path = get_ocr_binary_path();

    // Run the compiled binary
    let output = Command::new(binary_path)
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
