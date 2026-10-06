use std::path::PathBuf;
use std::{env, fs};

const SIDECAR_NAME: &str = "flare-bridge";

fn main() {
    ensure_sidecar_placeholder();
    tauri_build::build();
}

/// tauri-build refuses to compile when an `externalBin` file is missing, which would make
/// `cargo check`, `clippy` and `test` fail on any checkout that has not run
/// `bun run build:bridge`. Debug builds get an empty stand-in; release builds still need the real binary.
fn ensure_sidecar_placeholder() {
    if env::var("PROFILE").as_deref() == Ok("release") {
        return;
    }
    let target = env::var("TARGET").expect("cargo sets TARGET for build scripts");
    let extension = if target.contains("windows") {
        ".exe"
    } else {
        ""
    };
    let manifest_dir = env::var("CARGO_MANIFEST_DIR").expect("cargo sets CARGO_MANIFEST_DIR");
    let binaries = PathBuf::from(manifest_dir).join("binaries");
    let sidecar = binaries.join(format!("{SIDECAR_NAME}-{target}{extension}"));
    if sidecar.exists() {
        return;
    }
    fs::create_dir_all(&binaries).expect("create the sidecar directory");
    fs::write(&sidecar, b"").expect("write the sidecar placeholder");
    println!(
        "cargo:warning={} is an empty placeholder; run `bun run build:bridge` before using the agent",
        sidecar.display()
    );
}
