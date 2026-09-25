//! Imported logo watermarks live in the user data folder (`watermarks/`).

use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::AppHandle;

use crate::catalog;

const WM_EXTS: &[&str] = &["png", "jpg", "jpeg", "webp", "gif"];

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WatermarkEntry {
    pub name: String,
    pub path: String,
}

pub fn watermarks_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = catalog::albums_dir(app)?.join("watermarks");
    if !dir.exists() {
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    }
    Ok(dir)
}

fn is_wm_file(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| WM_EXTS.iter().any(|x| e.eq_ignore_ascii_case(x)))
        .unwrap_or(false)
}

fn unique_dest(dir: &Path, file_name: &str) -> PathBuf {
    let dest = dir.join(file_name);
    if !dest.exists() {
        return dest;
    }
    let stem = Path::new(file_name)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("watermark");
    let ext = Path::new(file_name)
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("png");
    let mut n = 2u32;
    loop {
        let candidate = dir.join(format!("{stem}_{n}.{ext}"));
        if !candidate.exists() {
            return candidate;
        }
        n += 1;
    }
}

#[tauri::command]
pub fn list_watermarks(app: AppHandle) -> Result<Vec<WatermarkEntry>, String> {
    let dir = watermarks_dir(&app)?;
    let mut out = Vec::new();
    if let Ok(rd) = fs::read_dir(&dir) {
        for entry in rd.flatten() {
            let path = entry.path();
            if !path.is_file() || !is_wm_file(&path) {
                continue;
            }
            let name = path
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("watermark")
                .to_string();
            out.push(WatermarkEntry {
                name,
                path: path.to_string_lossy().into_owned(),
            });
        }
    }
    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(out)
}

#[tauri::command]
pub fn import_watermarks(source_paths: Vec<String>, app: AppHandle) -> Result<Vec<WatermarkEntry>, String> {
    let dir = watermarks_dir(&app)?;
    for src in source_paths {
        let from = PathBuf::from(&src);
        if !from.is_file() || !is_wm_file(&from) {
            continue;
        }
        let file_name = from
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("watermark.png");
        let dest = unique_dest(&dir, file_name);
        fs::copy(&from, &dest).map_err(|e| e.to_string())?;
    }
    list_watermarks(app)
}

#[tauri::command]
pub fn remove_watermark(path: String, app: AppHandle) -> Result<Vec<WatermarkEntry>, String> {
    let dir = watermarks_dir(&app)?;
    let p = PathBuf::from(&path);
    if p.starts_with(&dir) && p.is_file() {
        let _ = fs::remove_file(&p);
    }
    list_watermarks(app)
}
