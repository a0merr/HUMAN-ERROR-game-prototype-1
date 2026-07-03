// HUMAN ERROR — desktop wrapper commands.
// Keep this thin: everything game-side goes through client/platform.mjs, so
// steamworks integration later only touches that shim and this file.

use base64::Engine;

/// Save a clip (Videos) or screenshot (Pictures) into an OS media dir.
/// Returns the absolute path written, for the in-game "saved to" toast.
#[tauri::command]
fn save_media(kind: String, filename: String, data_b64: String) -> Result<String, String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data_b64)
        .map_err(|e| e.to_string())?;
    if bytes.is_empty() {
        return Err("empty payload".into());
    }
    let base = match kind.as_str() {
        "picture" => dirs::picture_dir(),
        _ => dirs::video_dir(),
    }
    .or_else(dirs::home_dir)
    .ok_or("no target directory")?;
    let dir = base.join("HUMAN ERROR");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    // strip anything path-like from the client-supplied name
    let safe: String = filename
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || "-_. ".contains(*c))
        .collect();
    let name = if safe.trim().is_empty() { "clip.webm".to_string() } else { safe };
    let path = dir.join(name);
    std::fs::write(&path, bytes).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}

/// Open an http(s) URL in the system browser (invite links etc.).
#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err("only http(s) urls".into());
    }
    open::that(url).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![save_media, open_url])
        .run(tauri::generate_context!())
        .expect("error while running HUMAN ERROR");
}
