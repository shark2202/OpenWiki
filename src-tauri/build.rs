fn main() {
    // Pre-compile the macOS OCR Swift helper so end users don't need swiftc
    // (i.e. don't need Xcode Command Line Tools) to use OCR at runtime.
    // The binary is bundled as a Tauri resource — see tauri.conf.json.
    #[cfg(target_os = "macos")]
    {
        let manifest_dir = std::path::PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap());

        let swift_src = manifest_dir.join("resources/openwiki_ocr.swift");
        let swift_bin = manifest_dir.join("resources/openwiki_ocr_bin");

        println!("cargo:rerun-if-changed={}", swift_src.display());

        if !swift_src.exists() {
            panic!("OCR Swift source not found at {}", swift_src.display());
        }

        // Idempotency check: only invoke swiftc if the binary is missing or
        // older than the source. Rewriting the binary on every build caused
        // a watcher loop in `tauri dev`: write bin → watcher sees change →
        // restart cargo → build.rs runs → write bin → ... (infinite loop).
        let needs_rebuild = match (swift_src.metadata(), swift_bin.metadata()) {
            (Ok(src_meta), Ok(bin_meta)) => match (src_meta.modified(), bin_meta.modified()) {
                (Ok(src_time), Ok(bin_time)) => src_time > bin_time,
                _ => true,
            },
            _ => true,
        };

        if needs_rebuild {
            // Pin the deployment target so the helper runs on older macOS.
            // Without this, swiftc defaults to the build machine's OS version
            // (macOS 15 on CI), and the binary fails to load on anything older
            // ("built for macOS 15.0 which is newer than running OS"). swiftc
            // ignores the MACOSX_DEPLOYMENT_TARGET env var, so the version must
            // be baked into the -target triple. Cargo's arch name (aarch64)
            // differs from the Apple triple arch (arm64), so map it.
            let arch = match std::env::var("CARGO_CFG_TARGET_ARCH").as_deref() {
                Ok("x86_64") => "x86_64",
                _ => "arm64",
            };
            let target = format!("{}-apple-macos12.0", arch);
            let status = std::process::Command::new("/usr/bin/swiftc")
                .args([
                    "-O",
                    "-target",
                    &target,
                    swift_src.to_str().unwrap(),
                    "-o",
                    swift_bin.to_str().unwrap(),
                ])
                .status();

            match status {
                Ok(s) if s.success() => {
                    println!(
                        "cargo:warning=Pre-compiled OCR Swift binary -> {}",
                        swift_bin.display()
                    );
                }
                Ok(s) => {
                    panic!("swiftc exited with status {} while compiling OCR helper", s);
                }
                Err(e) => {
                    panic!("Failed to invoke swiftc for OCR helper: {}. Is Xcode Command Line Tools installed on the build machine?", e);
                }
            }
        }
    }

    tauri_build::build()
}
