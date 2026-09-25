//! Compact on-disk catalog (`catalog.rrcat`).
//!
//! Layout: `RRCT` + u16le version + u32le uncompressed length + zstd payload.
//! Payload is compact JSON with interned directory prefixes so large Lightroom
//! imports stay small and parse in a single decode.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::file_management::AlbumItem;

const MAGIC: &[u8; 4] = b"RRCT";
const VERSION: u16 = 1;
const ZSTD_LEVEL: i32 = 3;

static CATALOG_MEM: Lazy<Mutex<Option<CatalogMem>>> = Lazy::new(|| Mutex::new(None));

#[derive(Clone, Default)]
struct CatalogMem {
    albums: Vec<AlbumItem>,
    photos: HashMap<String, PhotoMeta>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct PhotoMeta {
    #[serde(default, skip_serializing_if = "is_zero_u8")]
    pub rating: u8,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub color: String,
    #[serde(default, skip_serializing_if = "is_zero_i8")]
    pub pick: i8,
}

fn is_zero_u8(v: &u8) -> bool {
    *v == 0
}
fn is_zero_i8(v: &i8) -> bool {
    *v == 0
}

#[derive(Serialize, Deserialize)]
struct CatalogDoc {
    v: u8,
    prefixes: Vec<String>,
    photos: Vec<PhotoRec>,
    albums: Vec<AlbumWire>,
}

#[derive(Serialize, Deserialize)]
struct PhotoRec {
    p: u16,
    n: String,
    #[serde(default, skip_serializing_if = "is_zero_u8")]
    r: u8,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    c: String,
    #[serde(default, skip_serializing_if = "is_zero_i8")]
    k: i8,
}

#[derive(Serialize, Deserialize)]
#[serde(tag = "t")]
enum AlbumWire {
    #[serde(rename = "a")]
    Album {
        id: String,
        n: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        icon: Option<String>,
        i: Vec<u32>,
    },
    #[serde(rename = "g")]
    Group {
        id: String,
        n: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        icon: Option<String>,
        ch: Vec<AlbumWire>,
    },
}

fn default_albums_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok(data_dir.join("albums"))
}

fn pointer_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(default_albums_dir(app)?.join("catalog.link"))
}

fn read_pointer(app: &AppHandle) -> Option<PathBuf> {
    let text = fs::read_to_string(pointer_path(app).ok()?).ok()?;
    let trimmed = text.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(PathBuf::from(trimmed))
    }
}

fn write_pointer(app: &AppHandle, dir: &Path) -> Result<(), String> {
    let default = default_albums_dir(app)?;
    fs::create_dir_all(&default).map_err(|e| e.to_string())?;
    let p = pointer_path(app)?;
    if paths_equal(dir, &default) {
        let _ = fs::remove_file(&p);
        return Ok(());
    }
    fs::write(p, dir.to_string_lossy().as_bytes()).map_err(|e| e.to_string())
}

fn paths_equal(a: &Path, b: &Path) -> bool {
    match (fs::canonicalize(a), fs::canonicalize(b)) {
        (Ok(x), Ok(y)) => x == y,
        _ => a == b,
    }
}

fn copy_dir_recursive(src: &Path, dest: &Path) -> Result<(), String> {
    fs::create_dir_all(dest).map_err(|e| e.to_string())?;
    for entry in fs::read_dir(src).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let from = entry.path();
        let to = dest.join(entry.file_name());
        if from.is_dir() {
            copy_dir_recursive(&from, &to)?;
        } else {
            fs::copy(&from, &to).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

pub fn albums_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let default = default_albums_dir(app)?;
    let from_settings = crate::app_settings::load_settings(app.clone())
        .ok()
        .and_then(|s| s.data_dir)
        .filter(|s| !s.trim().is_empty())
        .map(PathBuf::from);
    let dir = from_settings.or_else(|| read_pointer(app)).unwrap_or(default);
    if !dir.exists() {
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    }
    Ok(dir)
}

fn rrcat_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(albums_dir(app)?.join("catalog.rrcat"))
}

fn legacy_json_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(albums_dir(app)?.join("albums.json"))
}

fn split_prefix(path: &str) -> (String, String) {
    let p = Path::new(path);
    match (p.parent(), p.file_name()) {
        (Some(parent), Some(name)) if !parent.as_os_str().is_empty() => (
            parent.to_string_lossy().into_owned(),
            name.to_string_lossy().into_owned(),
        ),
        _ => (String::new(), path.to_string()),
    }
}

fn intern_prefix(prefixes: &mut Vec<String>, prefix: String) -> u16 {
    if let Some(i) = prefixes.iter().position(|p| p == &prefix) {
        return i as u16;
    }
    let i = prefixes.len() as u16;
    prefixes.push(prefix);
    i
}

fn encode_albums(
    items: &[AlbumItem],
    prefixes: &mut Vec<String>,
    photo_index: &mut HashMap<String, u32>,
    photos: &mut Vec<PhotoRec>,
    meta: &HashMap<String, PhotoMeta>,
) -> Vec<AlbumWire> {
    items
        .iter()
        .map(|item| match item {
            AlbumItem::Album {
                id,
                name,
                icon,
                images,
            } => {
                let idxs = images
                    .iter()
                    .map(|path| {
                        if let Some(&idx) = photo_index.get(path) {
                            return idx;
                        }
                        let (dir, name) = split_prefix(path);
                        let p = intern_prefix(prefixes, dir);
                        let m = meta.get(path).cloned().unwrap_or_default();
                        let idx = photos.len() as u32;
                        photos.push(PhotoRec {
                            p,
                            n: name,
                            r: m.rating,
                            c: m.color,
                            k: m.pick,
                        });
                        photo_index.insert(path.clone(), idx);
                        idx
                    })
                    .collect();
                AlbumWire::Album {
                    id: id.clone(),
                    n: name.clone(),
                    icon: icon.clone(),
                    i: idxs,
                }
            }
            AlbumItem::Group {
                id,
                name,
                icon,
                children,
            } => AlbumWire::Group {
                id: id.clone(),
                n: name.clone(),
                icon: icon.clone(),
                ch: encode_albums(children, prefixes, photo_index, photos, meta),
            },
        })
        .collect()
}

fn join_stored(prefix: &str, name: &str) -> String {
    if prefix.is_empty() {
        return name.to_string();
    }
    let mut out = String::with_capacity(prefix.len() + 1 + name.len());
    out.push_str(prefix);
    if !prefix.ends_with('/') && !prefix.ends_with('\\') {
        out.push(if prefix.contains('\\') { '\\' } else { '/' });
    }
    out.push_str(name);
    out
}

fn decode_albums(items: Vec<AlbumWire>, photos: &[PhotoRec], prefixes: &[String]) -> Vec<AlbumItem> {
    items
        .into_iter()
        .map(|item| match item {
            AlbumWire::Album { id, n, icon, i } => {
                let images = i
                    .into_iter()
                    .filter_map(|idx| {
                        let rec = photos.get(idx as usize)?;
                        let prefix = prefixes.get(rec.p as usize).map(String::as_str).unwrap_or("");
                        Some(join_stored(prefix, &rec.n))
                    })
                    .collect();
                AlbumItem::Album {
                    id,
                    name: n,
                    icon,
                    images,
                }
            }
            AlbumWire::Group { id, n, icon, ch } => AlbumItem::Group {
                id,
                name: n,
                icon,
                children: decode_albums(ch, photos, prefixes),
            },
        })
        .collect()
}

fn encode_file(albums: &[AlbumItem], meta: &HashMap<String, PhotoMeta>) -> Result<Vec<u8>, String> {
    let mut prefixes = Vec::new();
    let mut photo_index = HashMap::new();
    let mut photos = Vec::new();
    // Keep photo meta even if a photo dropped out of every album.
    for (path, m) in meta {
        if photo_index.contains_key(path) {
            continue;
        }
        let (dir, name) = split_prefix(path);
        let p = intern_prefix(&mut prefixes, dir);
        let idx = photos.len() as u32;
        photos.push(PhotoRec {
            p,
            n: name,
            r: m.rating,
            c: m.color.clone(),
            k: m.pick,
        });
        photo_index.insert(path.clone(), idx);
    }
    let albums_wire = encode_albums(albums, &mut prefixes, &mut photo_index, &mut photos, meta);
    let doc = CatalogDoc {
        v: 1,
        prefixes,
        photos,
        albums: albums_wire,
    };
    let json = serde_json::to_vec(&doc).map_err(|e| e.to_string())?;
    let compressed = zstd::bulk::compress(&json, ZSTD_LEVEL).map_err(|e| e.to_string())?;
    let mut out = Vec::with_capacity(10 + compressed.len());
    out.extend_from_slice(MAGIC);
    out.extend_from_slice(&VERSION.to_le_bytes());
    out.extend_from_slice(&(json.len() as u32).to_le_bytes());
    out.extend_from_slice(&compressed);
    Ok(out)
}

fn decode_file(bytes: &[u8]) -> Result<(Vec<AlbumItem>, HashMap<String, PhotoMeta>), String> {
    if bytes.len() < 10 || &bytes[0..4] != MAGIC {
        return Err("not a RustROOM catalog".into());
    }
    let version = u16::from_le_bytes([bytes[4], bytes[5]]);
    if version != VERSION {
        return Err(format!("unsupported catalog version {version}"));
    }
    let uncompressed = u32::from_le_bytes([bytes[6], bytes[7], bytes[8], bytes[9]]) as usize;
    let json = zstd::bulk::decompress(&bytes[10..], uncompressed.max(1)).map_err(|e| e.to_string())?;
    let doc: CatalogDoc = serde_json::from_slice(&json).map_err(|e| e.to_string())?;
    let mut meta = HashMap::with_capacity(doc.photos.len());
    for rec in &doc.photos {
        let prefix = doc.prefixes.get(rec.p as usize).map(String::as_str).unwrap_or("");
        let path = join_stored(prefix, &rec.n);
        if rec.r != 0 || !rec.c.is_empty() || rec.k != 0 {
            meta.insert(
                path,
                PhotoMeta {
                    rating: rec.r,
                    color: rec.c.clone(),
                    pick: rec.k,
                },
            );
        }
    }
    let albums = decode_albums(doc.albums, &doc.photos, &doc.prefixes);
    Ok((albums, meta))
}

fn read_disk(app: &AppHandle) -> Result<CatalogMem, String> {
    let rrcat = rrcat_path(app)?;
    if rrcat.exists() {
        let bytes = fs::read(&rrcat).map_err(|e| e.to_string())?;
        let (albums, photos) = decode_file(&bytes)?;
        return Ok(CatalogMem { albums, photos });
    }
    let legacy = legacy_json_path(app)?;
    if legacy.exists() {
        let content = fs::read_to_string(&legacy).map_err(|e| e.to_string())?;
        let albums: Vec<AlbumItem> = serde_json::from_str(&content).map_err(|e| e.to_string())?;
        return Ok(CatalogMem {
            albums,
            photos: HashMap::new(),
        });
    }
    Ok(CatalogMem::default())
}

fn write_disk(app: &AppHandle, mem: &CatalogMem) -> Result<(), String> {
    let path = rrcat_path(app)?;
    let bytes = encode_file(&mem.albums, &mem.photos)?;
    let tmp = path.with_extension("rrcat.tmp");
    fs::write(&tmp, &bytes).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &path).map_err(|e| e.to_string())?;
    Ok(())
}

fn with_mem<T>(app: &AppHandle, f: impl FnOnce(&mut CatalogMem) -> T) -> Result<T, String> {
    let mut guard = CATALOG_MEM.lock().map_err(|e| e.to_string())?;
    if guard.is_none() {
        *guard = Some(read_disk(app)?);
    }
    Ok(f(guard.as_mut().unwrap()))
}

pub fn load_albums(app: &AppHandle) -> Result<Vec<AlbumItem>, String> {
    with_mem(app, |m| m.albums.clone())
}

pub fn save_albums(app: &AppHandle, albums: Vec<AlbumItem>) -> Result<(), String> {
    with_mem(app, |m| {
        m.albums = albums;
    })?;
    let guard = CATALOG_MEM.lock().map_err(|e| e.to_string())?;
    let mem = guard.as_ref().ok_or("catalog not loaded")?;
    write_disk(app, mem)
}

pub fn upsert_photos(app: &AppHandle, photos: HashMap<String, PhotoMeta>) -> Result<(), String> {
    with_mem(app, |m| {
        for (k, v) in photos {
            m.photos.insert(k, v);
        }
    })?;
    let guard = CATALOG_MEM.lock().map_err(|e| e.to_string())?;
    let mem = guard.as_ref().ok_or("catalog not loaded")?;
    write_disk(app, mem)
}

pub fn photo_meta(_app: &AppHandle, path: &str) -> Option<PhotoMeta> {
    let guard = CATALOG_MEM.lock().ok()?;
    let mem = guard.as_ref()?;
    mem.photos.get(path).cloned()
}

pub fn all_photo_meta(app: &AppHandle) -> HashMap<String, PhotoMeta> {
    with_mem(app, |m| m.photos.clone()).unwrap_or_default()
}

pub fn invalidate_cache() {
    if let Ok(mut g) = CATALOG_MEM.lock() {
        *g = None;
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogLocation {
    pub directory: String,
    pub file: String,
    pub is_default: bool,
}

fn move_file(src: &Path, dest: &Path) -> Result<(), String> {
    if !src.exists() {
        return Ok(());
    }
    if paths_equal(src, dest) {
        return Ok(());
    }
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    if dest.exists() {
        return Err(format!(
            "destination already has {}",
            dest.file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_else(|| "a file".into())
        ));
    }
    match fs::rename(src, dest) {
        Ok(()) => Ok(()),
        Err(_) => {
            fs::copy(src, dest).map_err(|e| e.to_string())?;
            fs::remove_file(src).map_err(|e| e.to_string())?;
            Ok(())
        }
    }
}

#[tauri::command]
pub fn get_catalog_location(app: AppHandle) -> Result<CatalogLocation, String> {
    let dir = albums_dir(&app)?;
    let default = default_albums_dir(&app)?;
    Ok(CatalogLocation {
        directory: dir.to_string_lossy().into_owned(),
        file: rrcat_path(&app)?.to_string_lossy().into_owned(),
        is_default: paths_equal(&dir, &default),
    })
}

#[tauri::command]
pub fn set_catalog_location(directory: String, app: AppHandle) -> Result<CatalogLocation, String> {
    let default = default_albums_dir(&app)?;
    let dest_raw = directory.trim();
    let dest = if dest_raw.is_empty() {
        default.clone()
    } else {
        PathBuf::from(dest_raw)
    };
    fs::create_dir_all(&dest).map_err(|e| e.to_string())?;
    let dest = fs::canonicalize(&dest).unwrap_or(dest);

    let src_dir = albums_dir(&app)?;
    if !paths_equal(&src_dir, &dest) {
        move_file(&src_dir.join("catalog.rrcat"), &dest.join("catalog.rrcat"))?;
        let src_json = src_dir.join("albums.json");
        if src_json.exists() {
            move_file(&src_json, &dest.join("albums.json"))?;
        }
        let src_wm = src_dir.join("watermarks");
        if src_wm.exists() {
            let dest_wm = dest.join("watermarks");
            if !dest_wm.exists() {
                if fs::rename(&src_wm, &dest_wm).is_err() {
                    copy_dir_recursive(&src_wm, &dest_wm)?;
                    let _ = fs::remove_dir_all(&src_wm);
                }
            }
        }
        let src_settings = src_dir.join("settings.json");
        if src_settings.exists() {
            let _ = move_file(&src_settings, &dest.join("settings.json"));
        }
    }

    let mut settings = crate::app_settings::load_settings(app.clone())?;
    settings.data_dir = if paths_equal(&dest, &default) {
        None
    } else {
        Some(dest.to_string_lossy().into_owned())
    };
    crate::app_settings::save_settings(settings, app.clone())?;
    write_pointer(&app, &dest)?;
    invalidate_cache();
    get_catalog_location(app)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip_intern_and_zstd() {
        let albums = vec![AlbumItem::Album {
            id: "a1".into(),
            name: "Trip".into(),
            icon: None,
            images: vec![
                "C:\\Photos\\2024\\DSC_001.ARW".into(),
                "C:\\Photos\\2024\\DSC_002.ARW".into(),
            ],
        }];
        let mut meta = HashMap::new();
        meta.insert(
            "C:\\Photos\\2024\\DSC_001.ARW".into(),
            PhotoMeta {
                rating: 4,
                color: "red".into(),
                pick: 1,
            },
        );
        let bytes = encode_file(&albums, &meta).unwrap();
        assert!(bytes.starts_with(MAGIC));
        let (out, meta_out) = decode_file(&bytes).unwrap();
        match &out[0] {
            AlbumItem::Album { images, name, .. } => {
                assert_eq!(name, "Trip");
                assert_eq!(images.len(), 2);
                assert!(images[0].ends_with("DSC_001.ARW"));
            }
            _ => panic!("expected album"),
        }
        assert_eq!(meta_out.get("C:\\Photos\\2024\\DSC_001.ARW").unwrap().rating, 4);
        assert!(bytes.len() < 400);
    }
}
