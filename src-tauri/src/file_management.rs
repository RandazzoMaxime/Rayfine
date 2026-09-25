use memmap2::{Mmap, MmapOptions};
use std::borrow::Cow;
use std::collections::hash_map::DefaultHasher;
use std::collections::{HashMap, HashSet};
use std::fmt;
use std::fs;
use std::hash::{Hash, Hasher};
use std::io::Cursor;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Arc;
use std::sync::atomic::Ordering;
use std::thread;

use anyhow::Result;
use chrono::{DateTime, Utc};
use image::codecs::jpeg::JpegEncoder;
use image::{DynamicImage, GenericImageView, ImageBuffer, Luma};
use rayon::prelude::*;
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sysinfo::Disks;
use tauri::{AppHandle, Emitter, Manager};
use uuid::Uuid;
use walkdir::WalkDir;

use crate::AppState;
use crate::PendingMetadata;
#[cfg(target_os = "android")]
use crate::android_integration::*;
use crate::app_settings::*;
use crate::exif_processing;
use crate::formats::{is_raw_file, is_supported_image_file};
use crate::gpu_processing;
use crate::image_loader;
use crate::image_processing::GpuContext;
use crate::image_processing::{
    Crop, ImageMetadata, apply_coarse_rotation, apply_cpu_default_raw_processing, apply_crop,
    apply_flip, apply_geometry_warp, apply_rotation, auto_results_to_json,
    get_all_adjustments_from_json, perform_auto_analysis,
};
use crate::mask_generation::MaskDefinition;
use crate::preset_converter;
use crate::tagging::COLOR_TAG_PREFIX;

fn resolve_thumbnail_cache_dir(app_handle: &AppHandle) -> std::result::Result<PathBuf, String> {
    let cache_dir = app_handle
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?;
    let thumb_cache_dir = cache_dir.join("thumbnails");
    if !thumb_cache_dir.exists() {
        fs::create_dir_all(&thumb_cache_dir).map_err(|e| e.to_string())?;
    }
    Ok(thumb_cache_dir)
}

fn emit_thumbnail_cache_setup_error(app_handle: &AppHandle, path: &str, reason: &str) {
    let _ = app_handle.emit(
        "thumbnail-generation-error",
        serde_json::json!({ "path": path, "reason": reason }),
    );
}

fn compute_thumbnail_cache_hash(path_str: &str, adjustments_bytes: &[u8]) -> Option<String> {
    let (source_path, _) = parse_virtual_path(path_str);

    let img_mod_time = fs::metadata(&source_path)
        .ok()?
        .modified()
        .ok()?
        .duration_since(std::time::UNIX_EPOCH)
        .ok()?
        .as_secs();

    let mut hasher = blake3::Hasher::new();
    hasher.update(path_str.as_bytes());
    hasher.update(&img_mod_time.to_le_bytes());
    hasher.update(adjustments_bytes);
    Some(hasher.finalize().to_hex().to_string())
}

struct ImageFileMetadata {
    is_edited: bool,
    tags: Option<Vec<String>>,
    rating: u8,
    is_raw: bool,
}

fn resolve_image_metadata(
    image_path: &Path,
    sidecar_path: &Path,
    enable_xmp_sync: bool,
    settings: &AppSettings,
) -> ImageFileMetadata {
    let mut metadata = crate::exif_processing::load_sidecar(sidecar_path);

    if sync_metadata_from_xmp(image_path, &mut metadata)
        && let Ok(json) = serde_json::to_string_pretty(&metadata)
    {
        let _ = fs::write(sidecar_path, json);
    }
    let _ = enable_xmp_sync;

    let is_raw = crate::formats::is_raw_file(image_path);
    let tm_override = crate::image_processing::resolve_tonemapper_override(settings, is_raw);
    let is_edited =
        crate::image_processing::is_image_edited(&metadata.adjustments, is_raw, tm_override);
    ImageFileMetadata {
        is_edited,
        tags: metadata.tags,
        rating: metadata.rating,
        is_raw,
    }
}

fn emit_image_metadata_loaded(
    app_handle: &AppHandle,
    path: &str,
    rating: u8,
    is_edited: bool,
    tags: &Option<Vec<String>>,
) {
    let _ = app_handle.emit(
        "image-metadata-loaded",
        serde_json::json!({ "path": path, "rating": rating, "is_edited": is_edited, "tags": tags }),
    );
}

fn enqueue_metadata(
    app_handle: &AppHandle,
    virtual_path: String,
    image_path: PathBuf,
    sidecar_path: PathBuf,
) {
    let state = app_handle.state::<crate::AppState>();
    let manager = &state.metadata_manager;

    let mut pending = manager.pending.lock().unwrap();
    if !pending.insert(sidecar_path.clone()) {
        return;
    }
    drop(pending);

    manager.queue.lock().unwrap().push_back(PendingMetadata {
        virtual_path,
        image_path,
        sidecar_path,
    });
    manager.cvar.notify_one();
}

// Not compute-heavy — these threads mostly block waiting on iCloud to
// materialize a file, not burning CPU — so a small fixed pool is enough and
// doesn't need a user-facing setting the way thumbnail_worker_threads does.
const METADATA_WORKER_THREADS: usize = 4;

pub fn start_metadata_workers(app_handle: tauri::AppHandle) {
    let state = app_handle.state::<crate::AppState>();
    let manager = state.metadata_manager.clone();

    for _ in 0..METADATA_WORKER_THREADS {
        let app_clone = app_handle.clone();
        let manager_clone = manager.clone();

        std::thread::spawn(move || {
            loop {
                let item = {
                    let mut queue = manager_clone.queue.lock().unwrap();
                    while queue.is_empty() {
                        queue = manager_clone.cvar.wait(queue).unwrap();
                    }
                    queue.pop_front().unwrap()
                };

                let settings = load_settings(app_clone.clone()).unwrap_or_default();
                let enable_xmp_sync = settings.enable_xmp_sync.unwrap_or(false);

                let metadata = resolve_image_metadata(
                    &item.image_path,
                    &item.sidecar_path,
                    enable_xmp_sync,
                    &settings,
                );

                emit_image_metadata_loaded(
                    &app_clone,
                    &item.virtual_path,
                    metadata.rating,
                    metadata.is_edited,
                    &metadata.tags,
                );

                manager_clone
                    .pending
                    .lock()
                    .unwrap()
                    .remove(&item.sidecar_path);
            }
        });
    }
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Preset {
    pub id: String,
    pub name: String,
    pub adjustments: Value,
    #[serde(rename = "includeMasks", skip_serializing_if = "Option::is_none")]
    pub include_masks: Option<bool>,
    #[serde(
        rename = "includeCropTransform",
        skip_serializing_if = "Option::is_none"
    )]
    pub include_crop_transform: Option<bool>,
    #[serde(rename = "presetType", skip_serializing_if = "Option::is_none")]
    pub preset_type: Option<String>,
    /// LR `crs:Group` folder name when exporting/importing XMP (optional, not required on disk).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub group: Option<String>,
}

#[derive(Serialize)]
struct ExportPresetFile<'a> {
    creator: &'a str,
    presets: &'a [PresetItem],
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct PresetFolder {
    pub id: String,
    pub name: String,
    pub children: Vec<Preset>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub enum PresetItem {
    Preset(Preset),
    Folder(PresetFolder),
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct PresetFile {
    pub presets: Vec<PresetItem>,
}

#[derive(Debug)]
pub enum ReadFileError {
    Io(std::io::Error),
    Locked,
    Empty,
    NotFound,
    Invalid,
}

impl fmt::Display for ReadFileError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ReadFileError::Io(err) => write!(f, "IO error: {}", err),
            ReadFileError::Locked => write!(f, "File is locked"),
            ReadFileError::Empty => write!(f, "File is empty"),
            ReadFileError::NotFound => write!(f, "File not found"),
            ReadFileError::Invalid => write!(f, "Invalid file"),
        }
    }
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ImageFile {
    pub path: String,
    modified: u64,
    is_edited: bool,
    rating: u8,
    tags: Option<Vec<String>>,
    exif: Option<HashMap<String, String>>,
    is_virtual_copy: bool,
    is_cloud_placeholder: bool,
    is_raw: bool,
    group_id: Option<String>,
}

fn prefer_raw_over_jpeg(paths: Vec<String>) -> Vec<String> {
    let raw_stems: std::collections::HashSet<String> = paths
        .iter()
        .filter(|p| crate::formats::is_raw_file(p))
        .map(|p| make_group_key(Path::new(p)))
        .collect();
    if raw_stems.is_empty() {
        return paths;
    }
    paths
        .into_iter()
        .filter(|p| {
            crate::formats::is_raw_file(p) || !raw_stems.contains(&make_group_key(Path::new(p)))
        })
        .collect()
}

fn make_group_key(source_path: &Path) -> String {
    let parent = source_path.parent().unwrap_or(Path::new(""));
    let stem = source_path.file_stem().unwrap_or_default();
    format!("{}/{}", parent.to_string_lossy(), stem.to_string_lossy())
}

fn assign_group_ids(files: &mut [ImageFile], settings: &crate::app_settings::AppSettings) {
    let require_matching_exif = settings.require_matching_exif.unwrap_or(false);
    let group_edited_files = settings.group_edited_files.unwrap_or(true);

    #[derive(Clone)]
    struct Candidate {
        index: usize,
        source_path: PathBuf,
        key: String,
    }

    let candidates: Vec<Candidate> = files
        .iter()
        .enumerate()
        .filter(|(_, file)| !file.is_virtual_copy && (group_edited_files || !file.is_edited))
        .map(|(index, file)| {
            let (source_path, _) = parse_virtual_path(&file.path);
            let key = make_group_key(&source_path);
            Candidate {
                index,
                source_path,
                key,
            }
        })
        .collect();

    let mut stem_groups: HashMap<String, Vec<Candidate>> = HashMap::new();
    for candidate in candidates {
        stem_groups
            .entry(candidate.key.clone())
            .or_default()
            .push(candidate);
    }

    if require_matching_exif {
        let groupable_paths: Vec<PathBuf> = stem_groups
            .values()
            .filter(|candidates| candidates.len() >= 2)
            .flat_map(|candidates| candidates.iter().map(|c| c.source_path.clone()))
            .collect();
        let exif_dates: HashMap<PathBuf, Option<chrono::DateTime<chrono::Utc>>> = groupable_paths
            .par_iter()
            .map(|p| {
                (
                    p.clone(),
                    crate::exif_processing::try_get_exif_creation_date(p),
                )
            })
            .collect();

        stem_groups.retain(|_, candidates| {
            if candidates.len() < 2 {
                return false;
            }
            let first = exif_dates
                .get(&candidates[0].source_path)
                .copied()
                .flatten();
            if first.is_none() {
                return false;
            }
            candidates
                .iter()
                .skip(1)
                .all(|c| exif_dates.get(&c.source_path).copied().flatten() == first)
        });
    } else {
        stem_groups.retain(|_, candidates| candidates.len() >= 2);
    }

    for (key, candidates) in stem_groups {
        for candidate in candidates {
            files[candidate.index].group_id = Some(key.clone());
        }
    }
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ImportSettings {
    pub filename_template: String,
    pub organize_by_date: bool,
    pub date_folder_format: String,
    pub delete_after_import: bool,
    /// Skip files that already exist at destination (by name).
    #[serde(default)]
    pub skip_duplicates: bool,
    /// Build / refresh library previews after copy (frontend may also trigger).
    #[serde(default)]
    pub build_previews: bool,
    /// Preview quality hint: minimal | standard | one_to_one
    #[serde(default)]
    pub preview_quality: Option<String>,
    /// Optional develop preset id to apply after import (applied by frontend if set).
    #[serde(default)]
    pub develop_preset_id: Option<String>,
    /// Keywords to apply to imported files (frontend applies via tagging after import).
    #[serde(default)]
    pub keywords: Option<Vec<String>>,
    /// IPTC/DC creator (Artist) applied after import by frontend.
    #[serde(default)]
    pub creator: Option<String>,
    /// IPTC/DC copyright applied after import by frontend.
    #[serde(default)]
    pub copyright: Option<String>,
    /// Caption / description applied after import by frontend.
    #[serde(default)]
    pub caption: Option<String>,
    /// Request copy-as-DNG on import (best-effort; conversion may be deferred).
    #[serde(default)]
    pub copy_as_dng: bool,
}

pub fn parse_virtual_path(virtual_path: &str) -> (PathBuf, PathBuf) {
    let (source_path_str, copy_id) = if let Some((base, id)) = virtual_path.rsplit_once("?vc=") {
        (base.to_string(), Some(id.to_string()))
    } else {
        (virtual_path.to_string(), None)
    };

    let source_path = PathBuf::from(source_path_str);

    let sidecar_filename = if let Some(id) = copy_id {
        format!(
            "{}.{}.rrdata",
            source_path
                .file_name()
                .unwrap_or_default()
                .to_string_lossy(),
            &id
        )
    } else {
        format!(
            "{}.rrdata",
            source_path
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
        )
    };

    let sidecar_path = source_path.with_file_name(sidecar_filename);
    (source_path, sidecar_path)
}

#[tauri::command]
pub async fn read_exif_for_paths(
    paths: Vec<String>,
) -> Result<HashMap<String, HashMap<String, String>>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let exif_data: HashMap<String, HashMap<String, String>> = paths
            .par_iter()
            .filter_map(|virtual_path| {
                let (source_path, _) = parse_virtual_path(virtual_path);
                let source_path_str = source_path.to_string_lossy().to_string();

                let map = if let Some(sidecar_exif) =
                    crate::exif_processing::read_rrexif_sidecar(&source_path)
                {
                    sidecar_exif
                } else if is_cloud_placeholder(&source_path) {
                    HashMap::new()
                } else if let Ok(mmap) = read_file_mapped(&source_path) {
                    crate::exif_processing::read_exif_data(&source_path_str, &mmap)
                } else if let Ok(bytes) = fs::read(&source_path) {
                    crate::exif_processing::read_exif_data(&source_path_str, &bytes)
                } else {
                    HashMap::new()
                };

                if map.is_empty() {
                    None
                } else {
                    Some((virtual_path.clone(), map))
                }
            })
            .collect();

        Ok(exif_data)
    })
    .await
    .unwrap_or_else(|e| Err(format!("Task failed: {}", e)))
}

#[tauri::command]
pub async fn update_exif_fields(
    paths: Vec<String>,
    updates: HashMap<String, String>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        paths.par_iter().for_each(|path| {
            let original_path = Path::new(&path);
            let primary_path = crate::exif_processing::get_primary_sidecar_path(original_path);
            let temp_metadata = crate::exif_processing::load_sidecar(&primary_path);

            let mut exif_data = temp_metadata.exif.unwrap_or_else(|| {
                if let Some(existing) = crate::exif_processing::read_rrexif_sidecar(original_path) {
                    existing
                } else if let Ok(mmap) = read_file_mapped(original_path) {
                    crate::exif_processing::read_exif_data_from_bytes(path, &mmap)
                } else if let Ok(bytes) = fs::read(original_path) {
                    crate::exif_processing::read_exif_data_from_bytes(path, &bytes)
                } else {
                    HashMap::new()
                }
            });

            for (k, v) in &updates {
                let trimmed = v.trim();
                if trimmed.is_empty() {
                    exif_data.remove(k);
                } else {
                    exif_data.insert(k.clone(), trimmed.to_string());
                }
            }

            let mut final_metadata = crate::exif_processing::load_sidecar(&primary_path);

            final_metadata.exif = Some(exif_data);
            if let Ok(json) = serde_json::to_string_pretty(&final_metadata) {
                let _ = std::fs::write(&primary_path, json);
            }
            // Mirror IPTC-ish fields into Adobe .xmp for Lightroom interop
            let wants_xmp = updates.keys().any(|k| {
                matches!(
                    k.as_str(),
                    "ImageDescription"
                        | "Description"
                        | "XPTitle"
                        | "Caption"
                        | "Artist"
                        | "Creator"
                        | "XPAuthor"
                        | "Copyright"
                        | "Rights"
                        | "City"
                        | "Country"
                        | "Location"
                        | "State"
                        | "Province"
                        | "Headline"
                        | "Credit"
                        | "Source"
                        | "Instructions"
                        | "AuthorsPosition"
                        | "CountryCode"
                        | "UsageTerms"
                        | "WebStatement"
                        | "CopyrightStatus"
                        | "IntellectualGenre"
                        | "Event"
                        | "PersonInImage"
                        | "Scene"
                        | "SubjectCode"
                        | "CreatorWorkURL"
                        | "CiUrlWork"
                        | "JobIdentifier"
                        | "JobID"
                        | "DigitalSourceType"
                        | "CaptionWriter"
                        | "Writer"
                        | "Category"
                        | "SupplementalCategories"
                        | "Urgency"
                        | "CiEmailWork"
                        | "CiTelWork"
                        | "Email"
                        | "Phone"
                        | "CiAdrExtadr"
                        | "CiAdrCity"
                        | "CiAdrRegion"
                        | "CiAdrPcode"
                        | "CiAdrCtry"
                )
            });
            if wants_xmp {
                sync_metadata_to_xmp(original_path, &final_metadata, true);
            }
        });
        Ok(())
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

fn match_disk_kind(disks: &Disks, canonical: &Path) -> Option<bool> {
    let mut best_match: Option<(&Path, bool)> = None;

    for disk in disks.list() {
        let mount_point = disk.mount_point();
        if canonical.starts_with(mount_point) {
            let is_longer_match = best_match
                .map(|(current, _)| mount_point.as_os_str().len() > current.as_os_str().len())
                .unwrap_or(true);
            if is_longer_match {
                best_match = Some((mount_point, disk.kind() == sysinfo::DiskKind::HDD));
            }
        }
    }

    best_match.map(|(_, is_hdd)| is_hdd)
}

fn update_rotational_disk_flag(path: &str, app_handle: &AppHandle) {
    let state = app_handle.state::<crate::AppState>();
    let Ok(canonical) = Path::new(path).canonicalize() else {
        return;
    };

    let cached_match = {
        let cache = state.disks_cache.lock().unwrap();
        cache
            .as_ref()
            .and_then(|disks| match_disk_kind(disks, &canonical))
    };

    match cached_match {
        Some(is_hdd) => {
            state
                .thumbnail_manager
                .rotational_disk
                .store(is_hdd, Ordering::Relaxed);
        }
        None => {
            if !state.disks_cache_refreshing.swap(true, Ordering::Relaxed) {
                let refresh_app_handle = app_handle.clone();
                thread::spawn(move || {
                    let disks = Disks::new_with_refreshed_list();
                    let state = refresh_app_handle.state::<crate::AppState>();
                    *state.disks_cache.lock().unwrap() = Some(disks);
                    state.disks_cache_refreshing.store(false, Ordering::Relaxed);
                });
            }
        }
    }
}

#[tauri::command]
pub fn list_images_in_dir(path: String, app_handle: AppHandle) -> Result<Vec<ImageFile>, String> {
    let settings = load_settings(app_handle.clone()).unwrap_or_default();
    let enable_xmp_sync = settings.enable_xmp_sync.unwrap_or(false);

    update_rotational_disk_flag(&path, &app_handle);

    let entries = fs::read_dir(&path).map_err(|e| e.to_string())?;
    let mut images = Vec::new();
    let mut sidecars_by_filename: HashMap<String, Vec<Option<String>>> = HashMap::new();

    for entry in entries.filter_map(Result::ok) {
        let entry_path = entry.path();
        let file_name = entry
            .file_name()
            .into_string()
            .unwrap_or_else(|os| os.to_string_lossy().into_owned());

        if file_name.ends_with(".rrdata") {
            let base = &file_name[..file_name.len() - 7];

            let (source_filename, copy_id) =
                if base.len() >= 7 && base.as_bytes()[base.len() - 7] == b'.' {
                    let id = &base[base.len() - 6..];
                    if id.chars().all(|c| matches!(c, '0'..='9' | 'a'..='f')) {
                        (&base[..base.len() - 7], Some(id.to_string()))
                    } else {
                        (base, None)
                    }
                } else {
                    (base, None)
                };

            sidecars_by_filename
                .entry(source_filename.to_string())
                .or_default()
                .push(copy_id);
        } else if is_supported_image_file(&file_name) {
            images.push((file_name, entry_path));
        }
    }

    let tasks: Vec<_> = images
        .into_iter()
        .map(|(file_name, path_buf)| {
            let sidecars = sidecars_by_filename
                .remove(&file_name)
                .unwrap_or_else(|| vec![None]);
            let path_str = path_buf.to_string_lossy().into_owned();
            (path_str, file_name, path_buf, sidecars)
        })
        .collect();

    let mut result_list: Vec<ImageFile> = tasks
        .into_par_iter()
        .flat_map(|(path_str, file_name, path_buf, sidecars)| {
            let modified = fs::metadata(&path_buf)
                .ok()
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs())
                .unwrap_or(0);

            let is_cloud_placeholder = is_cloud_placeholder(&path_buf);

            let mut file_results = Vec::with_capacity(sidecars.len());

            for copy_id_opt in sidecars {
                let (virtual_path, is_virtual_copy, sidecar_filename) = match copy_id_opt {
                    Some(id) => (
                        format!("{}?vc={}", path_str, id),
                        true,
                        format!("{}.{}.rrdata", file_name, id),
                    ),
                    None => (path_str.clone(), false, format!("{}.rrdata", file_name)),
                };

                let sidecar_path = path_buf.with_file_name(sidecar_filename);

                let xmp_is_placeholder = enable_xmp_sync
                    && resolve_xmp_path(&path_buf)
                        .is_some_and(|p| crate::file_management::is_cloud_placeholder(&p));

                let metadata = if crate::file_management::is_cloud_placeholder(&sidecar_path)
                    || xmp_is_placeholder
                {
                    enqueue_metadata(
                        &app_handle,
                        virtual_path.clone(),
                        path_buf.clone(),
                        sidecar_path.clone(),
                    );
                    ImageFileMetadata {
                        is_edited: false,
                        tags: None,
                        rating: 0,
                        is_raw: crate::formats::is_raw_file(&path_buf),
                    }
                } else {
                    resolve_image_metadata(&path_buf, &sidecar_path, enable_xmp_sync, &settings)
                };

                file_results.push(ImageFile {
                    path: virtual_path,
                    modified,
                    is_edited: metadata.is_edited,
                    tags: metadata.tags,
                    exif: None,
                    is_virtual_copy,
                    is_raw: metadata.is_raw,
                    group_id: None,
                    rating: metadata.rating,
                    is_cloud_placeholder,
                });
            }

            file_results
        })
        .collect();

    assign_group_ids(&mut result_list, &settings);
    Ok(result_list)
}

#[tauri::command]
pub fn list_images_recursive(
    path: String,
    app_handle: AppHandle,
) -> Result<Vec<ImageFile>, String> {
    let settings = load_settings(app_handle.clone()).unwrap_or_default();
    let enable_xmp_sync = settings.enable_xmp_sync.unwrap_or(false);

    update_rotational_disk_flag(&path, &app_handle);

    let root_path = Path::new(&path);
    let mut images = Vec::new();

    let mut sidecars_by_path: HashMap<PathBuf, Vec<Option<String>>> = HashMap::new();

    for entry in WalkDir::new(root_path).into_iter().filter_map(Result::ok) {
        let entry_path = entry.path();
        if !entry_path.is_file() {
            continue;
        }

        let file_name = entry_path.file_name().unwrap_or_default().to_string_lossy();
        if let Some(base) = file_name.strip_suffix(".rrdata") {
            let (source_filename, copy_id) =
                if base.len() >= 7 && base.as_bytes()[base.len() - 7] == b'.' {
                    let id = &base[base.len() - 6..];
                    if id.chars().all(|c| matches!(c, '0'..='9' | 'a'..='f')) {
                        (&base[..base.len() - 7], Some(id.to_string()))
                    } else {
                        (base, None)
                    }
                } else {
                    (base, None)
                };

            if let Some(parent) = entry_path.parent() {
                sidecars_by_path
                    .entry(parent.join(source_filename))
                    .or_default()
                    .push(copy_id);
            }
        } else if is_supported_image_file(entry_path.to_string_lossy().as_ref()) {
            images.push(entry_path.to_path_buf());
        }
    }

    let tasks: Vec<_> = images
        .into_iter()
        .map(|path_buf| {
            let sidecars = sidecars_by_path
                .remove(&path_buf)
                .unwrap_or_else(|| vec![None]);
            let path_str = path_buf.to_string_lossy().into_owned();
            let file_name = path_buf
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .into_owned();
            (path_str, file_name, path_buf, sidecars)
        })
        .collect();

    let mut result_list: Vec<ImageFile> = tasks
        .into_par_iter()
        .flat_map(|(path_str, file_name, path_buf, sidecars)| {
            let modified = fs::metadata(&path_buf)
                .ok()
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs())
                .unwrap_or(0);

            let is_cloud_placeholder = is_cloud_placeholder(&path_buf);

            let mut file_results = Vec::with_capacity(sidecars.len());

            for copy_id_opt in sidecars {
                let (virtual_path, is_virtual_copy, sidecar_filename) = match copy_id_opt {
                    Some(id) => (
                        format!("{}?vc={}", path_str, id),
                        true,
                        format!("{}.{}.rrdata", file_name, id),
                    ),
                    None => (path_str.clone(), false, format!("{}.rrdata", file_name)),
                };

                let sidecar_path = path_buf.with_file_name(sidecar_filename);

                let xmp_is_placeholder = enable_xmp_sync
                    && resolve_xmp_path(&path_buf)
                        .is_some_and(|p| crate::file_management::is_cloud_placeholder(&p));

                let metadata = if crate::file_management::is_cloud_placeholder(&sidecar_path)
                    || xmp_is_placeholder
                {
                    enqueue_metadata(
                        &app_handle,
                        virtual_path.clone(),
                        path_buf.clone(),
                        sidecar_path.clone(),
                    );
                    ImageFileMetadata {
                        is_edited: false,
                        tags: None,
                        rating: 0,
                        is_raw: crate::formats::is_raw_file(&path_buf),
                    }
                } else {
                    resolve_image_metadata(&path_buf, &sidecar_path, enable_xmp_sync, &settings)
                };

                file_results.push(ImageFile {
                    path: virtual_path,
                    modified,
                    is_edited: metadata.is_edited,
                    tags: metadata.tags,
                    exif: None,
                    is_virtual_copy,
                    is_raw: metadata.is_raw,
                    group_id: None,
                    rating: metadata.rating,
                    is_cloud_placeholder,
                });
            }

            file_results
        })
        .collect();

    assign_group_ids(&mut result_list, &settings);
    Ok(result_list)
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum AlbumItem {
    Album {
        id: String,
        name: String,
        icon: Option<String>,
        images: Vec<String>,
    },
    Group {
        id: String,
        name: String,
        icon: Option<String>,
        children: Vec<AlbumItem>,
    },
}

pub fn sort_album_tree(items: &mut [AlbumItem]) {
    items.sort_by(|a, b| {
        let get_sort_key = |item: &AlbumItem| match item {
            AlbumItem::Group { name, .. } => (0, name.to_lowercase()),
            AlbumItem::Album { name, .. } => (1, name.to_lowercase()),
        };

        let key_a = get_sort_key(a);
        let key_b = get_sort_key(b);

        key_a.cmp(&key_b)
    });

    for item in items.iter_mut() {
        if let AlbumItem::Group { children, .. } = item {
            sort_album_tree(children);
        }
    }
}

#[tauri::command]
pub fn get_albums(app_handle: AppHandle) -> Result<Vec<AlbumItem>, String> {
    let mut items = crate::catalog::load_albums(&app_handle)?;
    sort_album_tree(&mut items);
    Ok(items)
}

#[tauri::command]
pub fn save_albums(mut tree: Vec<AlbumItem>, app_handle: AppHandle) -> Result<(), String> {
    sort_album_tree(&mut tree);
    crate::catalog::save_albums(&app_handle, tree)
}

#[tauri::command]
pub fn add_to_album(
    album_id: String,
    paths: Vec<String>,
    app_handle: AppHandle,
) -> Result<(), String> {
    let mut tree = get_albums(app_handle.clone())?;

    fn add_recursive(items: &mut [AlbumItem], target_id: &str, paths_to_add: &Vec<String>) -> bool {
        for item in items.iter_mut() {
            #[allow(clippy::collapsible_match)]
            match item {
                AlbumItem::Album { id, images, .. } if id == target_id => {
                    for p in paths_to_add {
                        if !images.contains(p) {
                            images.push(p.clone());
                        }
                    }
                    return true;
                }
                AlbumItem::Group { children, .. } => {
                    if add_recursive(children, target_id, paths_to_add) {
                        return true;
                    }
                }
                _ => {}
            }
        }
        false
    }

    if add_recursive(&mut tree, &album_id, &paths) {
        save_albums(tree, app_handle)?;
    }
    Ok(())
}

fn sync_album_path_changes(
    app_handle: &AppHandle,
    renames: Option<&HashMap<String, String>>,
    deletions: Option<&HashSet<String>>,
    folder_rename: Option<(&str, &str)>,
) {
    if let Ok(mut tree) = get_albums(app_handle.clone()) {
        let mut changed = false;

        fn process_nodes(
            nodes: &mut [AlbumItem],
            renames: Option<&HashMap<String, String>>,
            deletions: Option<&HashSet<String>>,
            folder_rename: Option<(&str, &str)>,
            changed: &mut bool,
        ) {
            for node in nodes.iter_mut() {
                match node {
                    AlbumItem::Album { images, .. } => {
                        let mut new_images = Vec::new();

                        for img in images.drain(..) {
                            let mut current_img = img;

                            if let Some((old_folder, new_folder)) = folder_rename {
                                let img_path = Path::new(&current_img);
                                let old_path = Path::new(old_folder);
                                if let Ok(stripped) = img_path.strip_prefix(old_path) {
                                    let new_img_path = Path::new(new_folder).join(stripped);
                                    current_img = new_img_path.to_string_lossy().into_owned();
                                    *changed = true;
                                }
                            }

                            if let Some(r) = renames {
                                if let Some(new_path) = r.get(&current_img) {
                                    current_img = new_path.clone();
                                    *changed = true;
                                } else if let Some((base_path, vc_id)) =
                                    current_img.rsplit_once("?vc=")
                                    && let Some(new_base) = r.get(base_path)
                                {
                                    current_img = format!("{}?vc={}", new_base, vc_id);
                                    *changed = true;
                                }
                            }

                            let mut is_deleted = false;
                            if let Some(d) = deletions {
                                if d.contains(&current_img) {
                                    is_deleted = true;
                                } else {
                                    let img_path = Path::new(&current_img);
                                    for del_path_str in d {
                                        let del_path = Path::new(del_path_str);
                                        if img_path.starts_with(del_path) {
                                            is_deleted = true;
                                            break;
                                        }

                                        if let Some((base_path, _)) =
                                            current_img.rsplit_once("?vc=")
                                            && base_path == del_path_str
                                        {
                                            is_deleted = true;
                                            break;
                                        }
                                    }
                                }
                            }

                            if !is_deleted {
                                new_images.push(current_img);
                            } else {
                                *changed = true;
                            }
                        }
                        *images = new_images;
                    }
                    AlbumItem::Group { children, .. } => {
                        process_nodes(children, renames, deletions, folder_rename, changed);
                    }
                }
            }
        }

        process_nodes(&mut tree, renames, deletions, folder_rename, &mut changed);

        if changed {
            let _ = save_albums(tree, app_handle.clone());
        }
    }
}

#[tauri::command]
pub fn get_album_images(
    paths: Vec<String>,
    app_handle: AppHandle,
) -> Result<Vec<ImageFile>, String> {
    let settings = load_settings(app_handle.clone()).unwrap_or_default();
    let enable_xmp_sync = settings.enable_xmp_sync.unwrap_or(false);

    let mut result_list: Vec<ImageFile> = paths
        .into_par_iter()
        .filter_map(|virtual_path| {
            let (source_path, sidecar_path) = parse_virtual_path(&virtual_path);
            if !source_path.exists() {
                return None;
            }

            let modified = fs::metadata(&source_path)
                .ok()
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs())
                .unwrap_or(0);

            let is_virtual_copy = virtual_path.contains("?vc=");
            let is_cloud_placeholder = is_cloud_placeholder(&source_path);

            let xmp_is_placeholder = enable_xmp_sync
                && resolve_xmp_path(&source_path)
                    .is_some_and(|p| crate::file_management::is_cloud_placeholder(&p));

            let metadata = if crate::file_management::is_cloud_placeholder(&sidecar_path)
                || xmp_is_placeholder
            {
                enqueue_metadata(
                    &app_handle,
                    virtual_path.clone(),
                    source_path.clone(),
                    sidecar_path.clone(),
                );
                ImageFileMetadata {
                    is_edited: false,
                    tags: None,
                    rating: 0,
                    is_raw: crate::formats::is_raw_file(&source_path),
                }
            } else {
                resolve_image_metadata(&source_path, &sidecar_path, enable_xmp_sync, &settings)
            };

            Some(ImageFile {
                path: virtual_path.clone(),
                modified,
                is_edited: metadata.is_edited,
                tags: metadata.tags,
                exif: None,
                is_virtual_copy,
                is_raw: metadata.is_raw,
                group_id: None,
                rating: metadata.rating,
                is_cloud_placeholder,
            })
        })
        .collect();

    assign_group_ids(&mut result_list, &settings);
    let catalog_meta = crate::catalog::all_photo_meta(&app_handle);
    if !catalog_meta.is_empty() {
        for file in &mut result_list {
            if let Some(meta) = catalog_meta.get(&file.path) {
                if file.rating == 0 && meta.rating > 0 {
                    file.rating = meta.rating;
                }
                let mut tags = file.tags.take().unwrap_or_default();
                if !meta.color.is_empty() && !tags.iter().any(|t| t.starts_with("color:")) {
                    tags.push(format!("color:{}", meta.color));
                }
                if meta.pick == 1 && !tags.iter().any(|t| t == "flag:pick") {
                    tags.push("flag:pick".into());
                } else if meta.pick == -1 && !tags.iter().any(|t| t == "flag:reject") {
                    tags.push("flag:reject".into());
                }
                file.tags = if tags.is_empty() { None } else { Some(tags) };
            }
        }
    }
    Ok(result_list)
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FolderNode {
    pub name: String,
    pub path: String,
    pub children: Vec<FolderNode>,
    pub is_dir: bool,
    pub image_count: usize,
    pub has_subdirs: bool,
    pub modified: u64,
    pub created: u64,
}

fn has_subdirs(path: &Path) -> bool {
    if let Ok(entries) = std::fs::read_dir(path) {
        for entry in entries.filter_map(Result::ok) {
            if let Ok(file_type) = entry.file_type()
                && file_type.is_dir()
            {
                let name = entry.file_name();
                if !name.to_string_lossy().starts_with('.') {
                    return true;
                }
            }
        }
    }
    false
}

fn scan_dir_lazy(
    path: &Path,
    expanded_folders: &HashSet<&str>,
    show_image_counts: bool,
    prefetch_one_level: bool,
) -> Result<(Vec<FolderNode>, usize), std::io::Error> {
    let mut children_folders = Vec::new();
    let mut current_dir_image_count = 0;

    let entries = match std::fs::read_dir(path) {
        Ok(entries) => entries,
        Err(e) => {
            log::warn!("Could not scan directory '{}': {}", path.display(), e);
            return Ok((Vec::new(), 0));
        }
    };

    for entry in entries.filter_map(Result::ok) {
        let current_path = entry.path();
        let (file_type, modified, created) = match entry.metadata() {
            Ok(meta) => {
                let ft = meta.file_type();
                let mod_time = meta.modified().unwrap_or(std::time::SystemTime::UNIX_EPOCH);
                let cre_time = meta.created().unwrap_or(mod_time);

                (
                    ft,
                    mod_time
                        .duration_since(std::time::SystemTime::UNIX_EPOCH)
                        .unwrap_or_default()
                        .as_secs(),
                    cre_time
                        .duration_since(std::time::SystemTime::UNIX_EPOCH)
                        .unwrap_or_default()
                        .as_secs(),
                )
            }
            Err(_) => continue,
        };

        let file_name = entry.file_name();
        let name_str = file_name.to_string_lossy();

        if name_str.starts_with('.') {
            continue;
        }

        if file_type.is_dir() {
            let path_str = current_path.to_string_lossy().into_owned();
            let is_expanded = expanded_folders.contains(path_str.as_str());

            let should_scan = is_expanded || prefetch_one_level;
            let next_prefetch = is_expanded;

            let (grand_children, sub_dir_own_images) = if should_scan {
                scan_dir_lazy(
                    &current_path,
                    expanded_folders,
                    show_image_counts,
                    next_prefetch,
                )?
            } else {
                let count = if show_image_counts {
                    WalkDir::new(&current_path)
                        .into_iter()
                        .filter_map(Result::ok)
                        .filter(|e| {
                            e.file_type().is_file()
                                && crate::formats::is_supported_image_file(e.path())
                        })
                        .count()
                } else {
                    0
                };
                (Vec::new(), count)
            };

            let has_any_subdirs = if should_scan {
                grand_children.iter().any(|c| c.is_dir)
            } else {
                has_subdirs(&current_path)
            };

            let grand_children_sum: usize = grand_children.iter().map(|c| c.image_count).sum();
            let total_child_count = sub_dir_own_images + grand_children_sum;

            children_folders.push(FolderNode {
                name: name_str.into_owned(),
                path: path_str,
                children: grand_children,
                is_dir: true,
                image_count: total_child_count,
                has_subdirs: has_any_subdirs,
                modified,
                created,
            });
        } else if show_image_counts
            && file_type.is_file()
            && crate::formats::is_supported_image_file(&current_path)
        {
            current_dir_image_count += 1;
        }
    }

    children_folders.sort_by_key(|a| a.name.to_lowercase());

    Ok((children_folders, current_dir_image_count))
}

fn get_folder_tree_sync(
    path: String,
    expanded_folders: Vec<String>,
    show_image_counts: bool,
) -> Result<FolderNode, String> {
    let root_path = Path::new(&path);
    if !root_path.is_dir() {
        return Err(format!("Directory does not exist: {}", path));
    }

    let (modified, created) = root_path
        .metadata()
        .map(|m| {
            let mod_time = m.modified().unwrap_or(std::time::SystemTime::UNIX_EPOCH);
            let cre_time = m.created().unwrap_or(mod_time);
            (
                mod_time
                    .duration_since(std::time::SystemTime::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_secs(),
                cre_time
                    .duration_since(std::time::SystemTime::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_secs(),
            )
        })
        .unwrap_or((0, 0));

    let expanded_set: HashSet<&str> = expanded_folders.iter().map(|s| s.as_str()).collect();

    let (children, own_count) = scan_dir_lazy(root_path, &expanded_set, show_image_counts, true)
        .map_err(|e| e.to_string())?;

    let children_sum: usize = children.iter().map(|c| c.image_count).sum();
    let has_subdirs = children.iter().any(|c| c.is_dir);

    let name = match root_path.file_name() {
        Some(n) => n.to_string_lossy().into_owned(),
        None => {
            let trimmed = path.trim_end_matches(&['/', '\\'][..]);
            if trimmed.is_empty() {
                path.clone()
            } else {
                trimmed.to_string()
            }
        }
    };

    Ok(FolderNode {
        name,
        path: path.clone(),
        children,
        is_dir: true,
        image_count: own_count + children_sum,
        has_subdirs,
        modified,
        created,
    })
}

#[tauri::command]
pub async fn get_folder_children(
    path: String,
    show_image_counts: bool,
) -> Result<Vec<FolderNode>, String> {
    match tauri::async_runtime::spawn_blocking(move || {
        let root_path = Path::new(&path);
        if !root_path.is_dir() {
            return Err(format!("Directory does not exist: {}", path));
        }
        let empty_set = HashSet::new();
        let (children, _) = scan_dir_lazy(root_path, &empty_set, show_image_counts, false)
            .map_err(|e| e.to_string())?;

        Ok(children)
    })
    .await
    {
        Ok(Ok(children)) => Ok(children),
        Ok(Err(e)) => Err(e),
        Err(e) => Err(format!("Task failed: {}", e)),
    }
}

#[tauri::command]
pub async fn get_folder_tree(
    path: String,
    expanded_folders: Vec<String>,
    show_image_counts: bool,
) -> Result<FolderNode, String> {
    match tauri::async_runtime::spawn_blocking(move || {
        get_folder_tree_sync(path, expanded_folders, show_image_counts)
    })
    .await
    {
        Ok(Ok(folder_node)) => Ok(folder_node),
        Ok(Err(e)) => Err(e),
        Err(e) => Err(format!("Failed to execute folder tree task: {}", e)),
    }
}

#[tauri::command]
pub async fn get_pinned_folder_trees(
    paths: Vec<String>,
    expanded_folders: Vec<String>,
    show_image_counts: bool,
) -> Result<Vec<FolderNode>, String> {
    let result = tauri::async_runtime::spawn_blocking(move || {
        let results: Vec<Result<FolderNode, String>> = paths
            .par_iter()
            .map(|path| {
                get_folder_tree_sync(path.clone(), expanded_folders.clone(), show_image_counts)
            })
            .collect();

        let mut folder_nodes = Vec::new();
        for result in results {
            match result {
                Ok(node) => folder_nodes.push(node),
                Err(e) => log::warn!("Failed to get tree for pinned folder: {}", e),
            }
        }
        folder_nodes
    })
    .await;

    match result {
        Ok(nodes) => Ok(nodes),
        Err(e) => Err(format!("Task failed: {}", e)),
    }
}

/// Checks if the given path exists and is an iCloud placeholder file on macOS.
#[cfg(target_os = "macos")]
pub fn is_cloud_placeholder(path: &Path) -> bool {
    use std::os::unix::ffi::OsStrExt;
    const SF_DATALESS: u32 = 0x4000_0000;

    let c_path = match std::ffi::CString::new(path.as_os_str().as_bytes()) {
        Ok(p) => p,
        Err(_) => return false,
    };
    let mut stat_buf: libc::stat = unsafe { std::mem::zeroed() };
    let ret = unsafe { libc::lstat(c_path.as_ptr(), &mut stat_buf) };
    ret == 0 && (stat_buf.st_flags & SF_DATALESS) != 0
}

#[cfg(not(target_os = "macos"))]
pub fn is_cloud_placeholder(_path: &Path) -> bool {
    false
}

pub fn read_file_mapped(path: &Path) -> Result<Mmap, ReadFileError> {
    if !path.is_file() {
        return Err(ReadFileError::Invalid);
    }
    if !path.exists() {
        return Err(ReadFileError::NotFound);
    }
    if path.metadata().map_err(ReadFileError::Io)?.len() == 0 {
        return Err(ReadFileError::Empty);
    }
    let file = fs::File::open(path).map_err(ReadFileError::Io)?;
    if file.try_lock_shared().is_err() {
        return Err(ReadFileError::Locked);
    }
    let mmap = unsafe {
        MmapOptions::new()
            .len(file.metadata().map_err(ReadFileError::Io)?.len() as usize)
            .map(&file)
            .map_err(ReadFileError::Io)?
    };
    Ok(mmap)
}

fn find_embedded_jpeg(exif: &exif::Exif, ifd: exif::In) -> Option<&[u8]> {
    let offset = exif
        .get_field(exif::Tag::JPEGInterchangeFormat, ifd)?
        .value
        .get_uint(0)? as usize;
    let len = exif
        .get_field(exif::Tag::JPEGInterchangeFormatLength, ifd)?
        .value
        .get_uint(0)? as usize;
    exif.buf().get(offset..offset + len)
}

fn apply_exif_orientation(img: DynamicImage, orientation: u32) -> DynamicImage {
    match orientation {
        2 => img.fliph(),
        3 => img.rotate180(),
        4 => img.flipv(),
        5 => img.rotate90().fliph(),
        6 => img.rotate90(),
        7 => img.rotate270().fliph(),
        8 => img.rotate270(),
        _ => img,
    }
}

fn try_load_embedded_raw_preview(source_path: &Path, target_res: u32) -> Option<DynamicImage> {
    let mmap = read_file_mapped(source_path).ok()?;
    let exif = exif_processing::read_exif(&mmap)?;

    let (jpeg_bytes, ifd) = find_embedded_jpeg(&exif, exif::In::PRIMARY)
        .map(|b| (b, exif::In::PRIMARY))
        .or_else(|| {
            find_embedded_jpeg(&exif, exif::In::THUMBNAIL).map(|b| (b, exif::In::THUMBNAIL))
        })?;

    let img = image::load_from_memory_with_format(jpeg_bytes, image::ImageFormat::Jpeg).ok()?;

    if img.width().max(img.height()) < (target_res as f32 * 0.95) as u32 {
        return None;
    }

    let orientation = exif
        .get_field(exif::Tag::Orientation, ifd)
        .and_then(|f| f.value.get_uint(0))
        .unwrap_or(1);

    Some(apply_exif_orientation(img, orientation))
}

pub fn generate_thumbnail_data(
    path_str: &str,
    gpu_context: Option<&GpuContext>,
    preloaded_image: Option<&DynamicImage>,
    app_handle: &AppHandle,
) -> anyhow::Result<DynamicImage> {
    let (source_path, sidecar_path) = parse_virtual_path(path_str);
    let source_path_str = source_path.to_string_lossy().to_string();
    let is_raw = is_raw_file(&source_path_str);

    let metadata: Option<ImageMetadata> = if is_cloud_placeholder(&sidecar_path) {
        enqueue_metadata(
            app_handle,
            path_str.to_string(),
            source_path.clone(),
            sidecar_path.clone(),
        );
        None
    } else {
        fs::read_to_string(&sidecar_path)
            .ok()
            .and_then(|content| serde_json::from_str(&content).ok())
    };

    let adjustments = metadata
        .as_ref()
        .map_or(serde_json::Value::Null, |m| m.adjustments.clone());

    if is_raw && adjustments.is_null() && preloaded_image.is_none() {
        let settings = load_settings(app_handle.clone()).unwrap_or_default();
        let target_res = settings.thumbnail_resolution.unwrap_or(720);
        if let Some(preview) = try_load_embedded_raw_preview(&source_path, target_res) {
            return Ok(preview);
        }
    }

    if let (Some(context), Some(meta)) = (gpu_context, metadata)
        && !meta.adjustments.is_null()
    {
        let state = app_handle.state::<AppState>();
        let settings = load_settings(app_handle.clone()).unwrap_or_default();
        let target_res = settings.thumbnail_resolution.unwrap_or(720);

        let base_cache_hash = crate::cache_utils::calculate_thumbnail_base_hash(&meta.adjustments);

        let crop_data: Option<Crop> = serde_json::from_value(meta.adjustments["crop"].clone()).ok();

        let cached_base: Option<(DynamicImage, f32)> = {
            let cache = state.thumbnail_geometry_cache.lock().unwrap();
            if let Some((cached_hash, img, scale)) = cache.get(path_str) {
                let mut sufficient_resolution = true;
                if let Some(c) = &crop_data
                    && c.width > 0.0
                    && c.height > 0.0
                {
                    let final_crop_max_dim =
                        (c.width as f32 * *scale).max(c.height as f32 * *scale);
                    if final_crop_max_dim < (target_res as f32 * 0.95) {
                        sufficient_resolution = false;
                    }
                }

                if *cached_hash == base_cache_hash && sufficient_resolution {
                    Some((img.clone(), *scale))
                } else {
                    None
                }
            } else {
                None
            }
        };

        let (processing_base, total_scale) = if let Some(hit) = cached_base {
            hit
        } else {
            let settings = load_settings(app_handle.clone()).unwrap_or_default();
            let mut raw_scale_factor = 1.0f32;

            let composite_image = if let Some(img) = preloaded_image {
                image_loader::composite_patches_on_image(img, &adjustments)?
            } else {
                let mmap_guard;
                let vec_guard;

                let file_slice: &[u8] = match read_file_mapped(&source_path) {
                    Ok(mmap) => {
                        mmap_guard = Some(mmap);
                        mmap_guard.as_ref().unwrap()
                    }
                    Err(e) => {
                        if preloaded_image.is_none() {
                            log::warn!("Fallback read for {}: {}", source_path_str, e);
                        }
                        let bytes = fs::read(&source_path).map_err(|io_err| {
                            anyhow::anyhow!(
                                "Fallback read failed for {}: {}",
                                source_path_str,
                                io_err
                            )
                        })?;
                        vec_guard = Some(bytes);
                        vec_guard.as_ref().unwrap()
                    }
                };

                let img = image_loader::load_and_composite(
                    file_slice,
                    &source_path_str,
                    &adjustments,
                    true,
                    &settings,
                    None,
                )?;

                if is_raw {
                    raw_scale_factor = crate::raw_processing::get_fast_demosaic_scale_factor(
                        file_slice,
                        img.width(),
                        img.height(),
                    );
                }
                img
            };

            let warped_image =
                apply_geometry_warp(Cow::Borrowed(&composite_image), &meta.adjustments);

            let blurred_image = crate::lens_blur::apply_lens_blur(warped_image, &meta.adjustments);

            let orientation_steps =
                meta.adjustments["orientationSteps"].as_u64().unwrap_or(0) as u8;
            let coarse_rotated_image = apply_coarse_rotation(blurred_image, orientation_steps);

            let (full_w, full_h) = coarse_rotated_image.dimensions();

            let mut processing_dim = target_res;
            if let Some(c) = &crop_data
                && c.width > 0.0
                && c.height > 0.0
            {
                let crop_max_dim_loaded = c.width.max(c.height) * raw_scale_factor as f64;
                let full_max_dim = full_w.max(full_h) as f64;
                if crop_max_dim_loaded > 0.0 {
                    processing_dim = ((target_res as f64 * full_max_dim / crop_max_dim_loaded)
                        .round() as u32)
                        .min(full_w.max(full_h));
                }
            }

            let (base, gpu_scale) = if full_w > processing_dim || full_h > processing_dim {
                let base = crate::image_processing::downscale_f32_image(
                    &coarse_rotated_image,
                    processing_dim,
                    processing_dim,
                );
                let scale = if full_w > 0 {
                    base.width() as f32 / full_w as f32
                } else {
                    1.0
                };
                (base, scale)
            } else {
                (coarse_rotated_image.into_owned(), 1.0)
            };

            let total_scale = gpu_scale * raw_scale_factor;

            let mut cache = state.thumbnail_geometry_cache.lock().unwrap();
            if cache.len() > 30 {
                cache.clear();
            }
            cache.insert(
                path_str.to_string(),
                (base_cache_hash, base.clone(), total_scale),
            );

            (base, total_scale)
        };

        let rotation_degrees = meta.adjustments["rotation"].as_f64().unwrap_or(0.0) as f32;
        let flip_horizontal = meta.adjustments["flipHorizontal"]
            .as_bool()
            .unwrap_or(false);
        let flip_vertical = meta.adjustments["flipVertical"].as_bool().unwrap_or(false);

        let flipped_image = apply_flip(Cow::Owned(processing_base), flip_horizontal, flip_vertical);
        let rotated_image = apply_rotation(flipped_image, rotation_degrees);

        let scaled_crop_json = if let Some(c) = &crop_data {
            serde_json::to_value(Crop {
                x: c.x * total_scale as f64,
                y: c.y * total_scale as f64,
                width: c.width * total_scale as f64,
                height: c.height * total_scale as f64,
            })
            .unwrap_or(serde_json::Value::Null)
        } else {
            serde_json::Value::Null
        };

        let cropped_preview = apply_crop(rotated_image, &scaled_crop_json);
        let (preview_w, preview_h) = cropped_preview.dimensions();
        let unscaled_crop_offset = crop_data.map_or((0.0, 0.0), |c| (c.x as f32, c.y as f32));

        let mask_definitions: Vec<MaskDefinition> = meta
            .adjustments
            .get("masks")
            .and_then(|m| serde_json::from_value(m.clone()).ok())
            .unwrap_or_else(Vec::new);

        let mask_bitmaps: Vec<ImageBuffer<Luma<u8>, Vec<u8>>> = mask_definitions
            .iter()
            .filter_map(|def| {
                crate::get_cached_or_generate_mask(
                    &state,
                    def,
                    preview_w,
                    preview_h,
                    total_scale,
                    (
                        unscaled_crop_offset.0 * total_scale,
                        unscaled_crop_offset.1 * total_scale,
                    ),
                    &meta.adjustments,
                )
            })
            .collect();

        let tm_override = crate::image_processing::resolve_tonemapper_override(&settings, is_raw);
        let gpu_adjustments = get_all_adjustments_from_json(&meta.adjustments, is_raw, tm_override);
        let lut_path = meta.adjustments["lutPath"].as_str();
        let lut = lut_path.and_then(|p| {
            let mut cache = state.lut_cache.lock().unwrap();
            if let Some(cached_lut) = cache.get(p) {
                return Some(cached_lut.clone());
            }
            if let Ok(loaded_lut) = crate::lut_processing::parse_lut_file(p) {
                let arc_lut = Arc::new(loaded_lut);
                cache.insert(p.to_string(), arc_lut.clone());
                return Some(arc_lut);
            }
            None
        });

        let mut hasher = DefaultHasher::new();
        path_str.hash(&mut hasher);
        meta.adjustments.to_string().hash(&mut hasher);
        let unique_hash = hasher.finish();

        if let Ok(processed_image) = gpu_processing::process_and_get_dynamic_image(
            context,
            &state,
            cropped_preview.as_ref(),
            unique_hash,
            gpu_processing::RenderRequest {
                adjustments: gpu_adjustments,
                mask_bitmaps: &mask_bitmaps,
                lut,
                roi: None,
            },
            "generate_thumbnail_data",
        ) {
            return Ok(processed_image);
        } else {
            return Ok(cropped_preview.into_owned());
        }
    }

    let settings = load_settings(app_handle.clone()).unwrap_or_default();

    let mut final_image = if let Some(img) = preloaded_image {
        image_loader::composite_patches_on_image(img, &adjustments)?
    } else {
        match read_file_mapped(&source_path) {
            Ok(mmap) => image_loader::load_and_composite(
                &mmap,
                &source_path_str,
                &adjustments,
                true,
                &settings,
                None,
            )?,
            Err(e) => {
                log::warn!("Fallback read for {}: {}", source_path_str, e);
                let bytes = fs::read(&source_path)?;
                image_loader::load_and_composite(
                    &bytes,
                    &source_path_str,
                    &adjustments,
                    true,
                    &settings,
                    None,
                )?
            }
        }
    };

    if adjustments.is_null() {
        let default_tm = if is_raw {
            settings.default_raw_tonemapper.as_deref().unwrap_or("agx")
        } else {
            settings
                .default_non_raw_tonemapper
                .as_deref()
                .unwrap_or("basic")
        };
        if default_tm == "agx" {
            if !is_raw {
                final_image = crate::image_processing::apply_srgb_to_linear(final_image);
            }
            crate::image_processing::apply_cpu_agx_tonemap(&mut final_image);
        } else if is_raw {
            apply_cpu_default_raw_processing(&mut final_image);
        }
    }

    let fallback_orientation_steps = adjustments["orientationSteps"].as_u64().unwrap_or(0) as u8;
    Ok(apply_coarse_rotation(Cow::Owned(final_image), fallback_orientation_steps).into_owned())
}

fn encode_thumbnail(image: &DynamicImage, target_width: u32) -> Result<Vec<u8>> {
    let thumbnail = crate::image_processing::downscale_f32_image(image, target_width, target_width);
    let mut buf = Cursor::new(Vec::new());
    let mut encoder = JpegEncoder::new_with_quality(&mut buf, 75);
    encoder.encode_image(&thumbnail.to_rgb8())?;
    Ok(buf.into_inner())
}

fn generate_single_thumbnail_and_cache(
    path_str: &str,
    thumb_cache_dir: &Path,
    gpu_context: Option<&GpuContext>,
    preloaded_image: Option<&DynamicImage>,
    force_regenerate: bool,
    app_handle: &AppHandle,
    settings: &AppSettings,
) -> Option<(String, u8, bool)> {
    let (source_path, sidecar_path) = parse_virtual_path(path_str);

    let (rating, is_edited, adjustments_bytes) = if is_cloud_placeholder(&sidecar_path) {
        enqueue_metadata(
            app_handle,
            path_str.to_string(),
            source_path.clone(),
            sidecar_path.clone(),
        );
        (0, false, Vec::new())
    } else if let Ok(content) = fs::read_to_string(&sidecar_path) {
        if let Ok(meta) = serde_json::from_str::<ImageMetadata>(&content) {
            let is_raw = crate::formats::is_raw_file(path_str);
            let tm = crate::image_processing::resolve_tonemapper_override(settings, is_raw);

            (
                meta.rating,
                crate::image_processing::is_image_edited(&meta.adjustments, is_raw, tm),
                serde_json::to_vec(&meta.adjustments).unwrap_or_default(),
            )
        } else {
            (0, false, Vec::new())
        }
    } else {
        (0, false, Vec::new())
    };

    let cache_hash = compute_thumbnail_cache_hash(path_str, &adjustments_bytes)?;

    let cache_filename = format!("{}.jpg", cache_hash);
    let cache_path = thumb_cache_dir.join(cache_filename);

    if !force_regenerate && cache_path.exists() {
        return Some((cache_path.to_string_lossy().into_owned(), rating, is_edited));
    }

    if is_cloud_placeholder(&source_path) {
        return None;
    }

    let target_width = settings.thumbnail_resolution.unwrap_or(720);

    if let Ok(thumb_image) =
        generate_thumbnail_data(path_str, gpu_context, preloaded_image, app_handle)
        && let Ok(thumb_data) = encode_thumbnail(&thumb_image, target_width)
    {
        let _ = fs::write(&cache_path, &thumb_data);
        return Some((cache_path.to_string_lossy().into_owned(), rating, is_edited));
    }
    None
}

fn prefetch_source_file(path_str: &str) {
    let (source_path, _) = parse_virtual_path(path_str);
    let _ = fs::read(&source_path);
}

pub fn start_thumbnail_workers(app_handle: tauri::AppHandle) {
    let state = app_handle.state::<crate::AppState>();
    let manager = state.thumbnail_manager.clone();
    let settings = load_settings(app_handle.clone()).unwrap_or_default();
    let thread_count = settings.thumbnail_worker_threads.unwrap_or(4).clamp(1, 16);

    for _ in 0..thread_count {
        let app_clone = app_handle.clone();
        let manager_clone = manager.clone();
        let worker_settings = settings.clone();

        std::thread::spawn(move || {
            loop {
                let path_to_process: String = {
                    let mut queue = manager_clone.queue.lock().unwrap();
                    while queue.is_empty() {
                        queue = manager_clone.cvar.wait(queue).unwrap();
                    }
                    let path = queue.pop_back().unwrap();

                    let mut processing = manager_clone.processing_now.lock().unwrap();
                    if processing.contains(&path) {
                        let state = app_clone.state::<crate::AppState>();
                        increment_thumbnail_progress(&state, &app_clone);
                        continue;
                    }
                    processing.insert(path.clone());
                    path
                };

                let state = app_clone.state::<crate::AppState>();
                let gpu_context =
                    crate::gpu_processing::get_or_init_gpu_context(&state, &app_clone).ok();

                if let Ok(cache_dir) = get_thumb_cache_dir(&app_clone) {
                    if manager_clone.rotational_disk.load(Ordering::Relaxed) {
                        let _io_permit = manager_clone.io_gate.lock().unwrap();
                        prefetch_source_file(&path_to_process);
                    }

                    let result = generate_single_thumbnail_and_cache(
                        &path_to_process,
                        &cache_dir,
                        gpu_context.as_ref(),
                        None,
                        false,
                        &app_clone,
                        &worker_settings,
                    );

                    if let Some((thumbnail_path, rating, is_edited)) = result {
                        emit_thumbnail_generated(
                            &app_clone,
                            &path_to_process,
                            &thumbnail_path,
                            rating,
                            is_edited,
                        );
                    }
                    increment_thumbnail_progress(&state, &app_clone);
                }
                manager_clone
                    .processing_now
                    .lock()
                    .unwrap()
                    .remove(&path_to_process);
            }
        });
    }
}

#[tauri::command]
pub fn update_thumbnail_queue(
    paths: Vec<String>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    let state = app_handle.state::<crate::AppState>();

    let mut queue = state.thumbnail_manager.queue.lock().unwrap();

    if paths.is_empty() {
        queue.clear();
        let mut tracker = state.thumbnail_progress.lock().unwrap();
        tracker.total = 0;
        tracker.completed = 0;
        drop(tracker);

        let _ = app_handle.emit(
            "thumbnail-progress",
            serde_json::json!({ "current": 0, "total": 0 }),
        );
        state.thumbnail_manager.cvar.notify_all();
        return Ok(());
    }

    let mut unique_paths = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for path in paths {
        if seen.insert(path.clone()) {
            unique_paths.push(path);
        }
    }

    queue.retain(|p| !seen.contains(p));

    while queue.len() + unique_paths.len() > 500 {
        queue.pop_front();
    }

    if state
        .thumbnail_manager
        .rotational_disk
        .load(Ordering::Relaxed)
    {
        unique_paths.sort();
        for path in unique_paths.into_iter().rev() {
            queue.push_back(path);
        }
    } else {
        for path in unique_paths {
            queue.push_back(path);
        }
    }

    let queue_len = queue.len();
    drop(queue);

    let mut tracker = state.thumbnail_progress.lock().unwrap();
    tracker.total = tracker.completed + queue_len;

    let current = tracker.completed;
    let total = tracker.total;
    drop(tracker);

    let _ = app_handle.emit(
        "thumbnail-progress",
        serde_json::json!({ "current": current, "total": total }),
    );

    state.thumbnail_manager.cvar.notify_all();
    Ok(())
}

pub fn add_to_thumbnail_queue(state: &AppState, count: usize, app_handle: &AppHandle) {
    let mut tracker = state.thumbnail_progress.lock().unwrap();
    tracker.total += count;
    let current = tracker.completed;
    let total = tracker.total;
    drop(tracker);

    let _ = app_handle.emit(
        "thumbnail-progress",
        serde_json::json!({ "current": current, "total": total }),
    );
}

pub fn increment_thumbnail_progress(state: &AppState, app_handle: &AppHandle) {
    let mut tracker = state.thumbnail_progress.lock().unwrap();
    tracker.completed += 1;
    let current = tracker.completed;
    let total = tracker.total;

    if current >= total {
        tracker.total = 0;
        tracker.completed = 0;
        drop(tracker);

        let _ = app_handle.emit(
            "thumbnail-progress",
            serde_json::json!({ "current": 0, "total": 0 }),
        );
        let _ = app_handle.emit("thumbnail-generation-complete", true);
    } else {
        drop(tracker);
        let _ = app_handle.emit(
            "thumbnail-progress",
            serde_json::json!({ "current": current, "total": total }),
        );
    }
}

fn emit_thumbnail_generated(
    app_handle: &AppHandle,
    path: &str,
    thumbnail_path: &str,
    rating: u8,
    is_edited: bool,
) {
    let _ = app_handle.emit(
        "thumbnail-generated",
        serde_json::json!({ "path": path, "thumbnailPath": thumbnail_path, "rating": rating, "is_edited": is_edited }),
    );
}

pub fn resolve_lens_params_in_adjustments(
    adjustments: &mut Value,
    exif_data: &Option<HashMap<String, String>>,
    lens_db: Option<&crate::lens_correction::LensDatabase>,
) {
    if let Some(map) = adjustments.as_object_mut() {
        let mode = map
            .get("lensCorrectionMode")
            .and_then(|v| v.as_str())
            .unwrap_or("manual");

        if mode == "auto" {
            if let Some(exif) = exif_data {
                let exif_maker = exif.get("Make").map(|s| s.as_str()).unwrap_or("");
                let exif_model = exif.get("LensModel").map(|s| s.as_str()).unwrap_or("");
                if let Some(db) = lens_db {
                    if let Some((detected_maker, detected_model)) =
                        crate::lens_correction::find_best_lens_match(db, exif_maker, exif_model)
                    {
                        map.insert(
                            "lensMaker".to_string(),
                            serde_json::to_value(&detected_maker).unwrap(),
                        );
                        map.insert(
                            "lensModel".to_string(),
                            serde_json::to_value(&detected_model).unwrap(),
                        );
                    } else {
                        map.remove("lensMaker");
                        map.remove("lensModel");
                    }
                }
            } else {
                map.remove("lensMaker");
                map.remove("lensModel");
            }
        }

        if let Some(db) = lens_db {
            let has_valid_lens = match (
                map.get("lensMaker").and_then(|v| v.as_str()),
                map.get("lensModel").and_then(|v| v.as_str()),
            ) {
                (Some(maker), Some(model)) if !maker.is_empty() && !model.is_empty() => {
                    let mut focal_length = 50.0;
                    let mut aperture = None;
                    let mut distance = None;

                    if let Some(exif) = exif_data {
                        if let Some(fl_str) = exif
                            .get("FocalLength")
                            .or(exif.get("FocalLengthIn35mmFilm"))
                            && let Ok(fl) = fl_str.replace(" mm", "").trim().parse::<f32>()
                        {
                            focal_length = fl;
                        }
                        if let Some(ap_str) = exif.get("ApertureValue").or(exif.get("FNumber"))
                            && let Ok(ap) = ap_str.replace("f/", "").trim().parse::<f32>()
                        {
                            aperture = Some(ap);
                        }
                        if let Some(dist_str) = exif.get("SubjectDistance")
                            && let Ok(dist) = dist_str.replace(" m", "").trim().parse::<f32>()
                        {
                            distance = Some(dist);
                        }
                    }

                    if let Some(params) = crate::lens_correction::resolve_lens_params(
                        db,
                        maker,
                        model,
                        focal_length,
                        aperture,
                        distance,
                    ) {
                        map.insert(
                            "lensDistortionParams".to_string(),
                            serde_json::to_value(params).unwrap(),
                        );
                        true
                    } else {
                        false
                    }
                }
                _ => false,
            };

            if !has_valid_lens {
                map.remove("lensDistortionParams");
            }
        }
    }
}

#[tauri::command]
pub fn get_supported_file_types() -> Result<serde_json::Value, String> {
    let raw_extensions: Vec<&str> = crate::formats::RAW_EXTENSIONS
        .iter()
        .map(|(ext, _)| *ext)
        .collect();
    let non_raw_extensions: Vec<&str> = crate::formats::NON_RAW_EXTENSIONS.to_vec();

    Ok(serde_json::json!({
        "raw": raw_extensions,
        "nonRaw": non_raw_extensions
    }))
}

#[tauri::command]
pub fn create_folder(path: String) -> Result<(), String> {
    let path_obj = Path::new(&path);
    if let (Some(parent), Some(new_folder_name_os)) = (path_obj.parent(), path_obj.file_name())
        && let Some(new_folder_name) = new_folder_name_os.to_str()
        && parent.exists()
    {
        for entry in fs::read_dir(parent).map_err(|e| e.to_string())? {
            if let Ok(entry) = entry
                && entry.file_name().to_string_lossy().to_lowercase()
                    == new_folder_name.to_lowercase()
            {
                return Err("A folder with that name already exists.".to_string());
            }
        }
    }
    fs::create_dir_all(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn rename_folder(path: String, new_name: String, app_handle: AppHandle) -> Result<(), String> {
    let p = Path::new(&path);
    if !p.is_dir() {
        return Err("Path is not a directory.".to_string());
    }
    if let Some(parent) = p.parent() {
        for entry in fs::read_dir(parent).map_err(|e| e.to_string())? {
            if let Ok(entry) = entry
                && entry.file_name().to_string_lossy().to_lowercase() == new_name.to_lowercase()
                && entry.path() != p
            {
                return Err("A folder with that name already exists.".to_string());
            }
        }
        let new_path = parent.join(&new_name);
        fs::rename(p, &new_path).map_err(|e| e.to_string())?;

        let new_folder_str = new_path.to_string_lossy().into_owned();
        sync_album_path_changes(&app_handle, None, None, Some((&path, &new_folder_str)));

        Ok(())
    } else {
        Err("Could not determine parent directory.".to_string())
    }
}

#[tauri::command]
pub fn delete_folder(path: String, app_handle: AppHandle) -> Result<(), String> {
    #[cfg(any(target_os = "windows", target_os = "macos", target_os = "linux"))]
    {
        if let Err(trash_error) = trash::delete(&path) {
            log::warn!(
                "Failed to move folder to trash: {}. Falling back to permanent delete.",
                trash_error
            );
            fs::remove_dir_all(&path).map_err(|e| e.to_string())?;
        }
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        fs::remove_dir_all(&path).map_err(|e| e.to_string())?;
    }

    let mut deletions = HashSet::new();
    deletions.insert(path);
    sync_album_path_changes(&app_handle, None, Some(&deletions), None);

    Ok(())
}

#[tauri::command]
pub fn duplicate_file(
    path: String,
    target_album_id: Option<String>,
    app_handle: AppHandle,
) -> Result<String, String> {
    let (source_path, source_sidecar_path) = parse_virtual_path(&path);
    if !source_path.is_file() {
        return Err("Source path is not a file.".to_string());
    }

    let parent = source_path
        .parent()
        .ok_or("Could not get parent directory")?;
    let stem = source_path
        .file_stem()
        .and_then(|s| s.to_str())
        .ok_or("Could not get file stem")?;
    let extension = source_path
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("");

    let mut counter = 1;
    let mut dest_path;
    loop {
        let new_stem = if counter == 1 {
            format!("{}_copy", stem)
        } else {
            format!("{}_copy_{}", stem, counter - 1)
        };
        dest_path = parent.join(format!("{}.{}", new_stem, extension));
        if !dest_path.exists() {
            break;
        }
        counter += 1;
    }

    fs::copy(&source_path, &dest_path).map_err(|e| e.to_string())?;

    if source_sidecar_path.exists()
        && let Some(dest_str) = dest_path.to_str()
    {
        let (_, dest_sidecar_path) = parse_virtual_path(dest_str);
        fs::copy(&source_sidecar_path, &dest_sidecar_path).map_err(|e| e.to_string())?;
    }

    let mut source_rrexif_name = source_path.file_name().unwrap().to_os_string();
    source_rrexif_name.push(".rrexif");
    let source_rrexif = source_path.with_file_name(source_rrexif_name);

    if source_rrexif.exists() {
        let mut dest_rrexif_name = dest_path.file_name().unwrap().to_os_string();
        dest_rrexif_name.push(".rrexif");
        let dest_rrexif = dest_path.with_file_name(dest_rrexif_name);
        let _ = fs::copy(&source_rrexif, &dest_rrexif);
    }

    let dest_path_str = dest_path.to_string_lossy().into_owned();

    if let Some(album_id) = target_album_id {
        let _ = add_to_album(album_id, vec![dest_path_str.clone()], app_handle);
    }

    Ok(dest_path_str)
}

fn find_all_associated_files(source_image_path: &Path) -> Result<Vec<PathBuf>, String> {
    let mut associated_files = vec![source_image_path.to_path_buf()];

    let mut rrexif_name = source_image_path
        .file_name()
        .unwrap_or_default()
        .to_os_string();
    rrexif_name.push(".rrexif");
    let rrexif_path = source_image_path.with_file_name(rrexif_name);

    if rrexif_path.exists() {
        associated_files.push(rrexif_path);
    }

    let parent_dir = source_image_path
        .parent()
        .ok_or("Could not determine parent directory")?;
    let source_filename = source_image_path
        .file_name()
        .ok_or("Could not get source filename")?
        .to_string_lossy();

    let primary_sidecar_name = format!("{}.rrdata", source_filename);
    let virtual_copy_prefix = format!("{}.", source_filename);

    if let Ok(entries) = fs::read_dir(parent_dir) {
        for entry in entries.filter_map(Result::ok) {
            let entry_path = entry.path();
            if !entry_path.is_file() {
                continue;
            }

            let entry_os_filename = entry.file_name();
            let entry_filename = entry_os_filename.to_string_lossy();

            if entry_filename == primary_sidecar_name
                || (entry_filename.starts_with(&virtual_copy_prefix)
                    && entry_filename.ends_with(".rrdata"))
            {
                associated_files.push(entry_path);
            }
        }
    }

    Ok(associated_files)
}

#[tauri::command]
pub fn copy_files(source_paths: Vec<String>, destination_folder: String) -> Result<(), String> {
    let dest_path = Path::new(&destination_folder);
    if !dest_path.is_dir() {
        return Err(format!(
            "Destination is not a folder: {}",
            destination_folder
        ));
    }

    let unique_source_images: HashSet<PathBuf> = source_paths
        .iter()
        .map(|p| parse_virtual_path(p).0)
        .collect();

    for source_image_path in unique_source_images {
        let all_files_to_copy = find_all_associated_files(&source_image_path)?;

        let source_parent = source_image_path
            .parent()
            .ok_or("Could not get parent directory")?;
        if source_parent == dest_path {
            let stem = source_image_path
                .file_stem()
                .and_then(|s| s.to_str())
                .ok_or("Could not get file stem")?;
            let extension = source_image_path
                .extension()
                .and_then(|s| s.to_str())
                .unwrap_or("");

            let mut counter = 1;
            let new_base_path = loop {
                let new_stem = format!("{}_copy_{}", stem, counter);
                let temp_path = source_parent.join(format!("{}.{}", new_stem, extension));
                if !temp_path.exists() {
                    break temp_path;
                }
                counter += 1;
            };
            let new_filename = new_base_path.file_name().unwrap().to_string_lossy();

            for original_file in all_files_to_copy {
                let original_full_filename = original_file.file_name().unwrap().to_string_lossy();
                let source_base_filename = source_image_path.file_name().unwrap().to_string_lossy();
                let new_dest_filename =
                    original_full_filename.replacen(&*source_base_filename, &new_filename, 1);
                let final_dest_path = dest_path.join(new_dest_filename);

                fs::copy(&original_file, &final_dest_path).map_err(|e| e.to_string())?;
            }
        } else {
            for file_to_copy in all_files_to_copy {
                if let Some(file_name) = file_to_copy.file_name() {
                    let dest_file_path = dest_path.join(file_name);
                    fs::copy(&file_to_copy, &dest_file_path).map_err(|e| e.to_string())?;
                }
            }
        }
    }
    Ok(())
}

/// Copy a single file to an explicit destination path (creates parent dirs).
/// Used by multi-file Web/Book gallery packages for unique basenames.
#[tauri::command]
pub fn copy_file_to(source_path: String, destination_path: String) -> Result<(), String> {
    // Virtual copies: path may include #vc suffix — strip via parse_virtual_path
    let (real_src, _) = parse_virtual_path(&source_path);
    if !real_src.is_file() {
        return Err(format!("Source is not a file: {}", real_src.display()));
    }
    let dest = Path::new(&destination_path);
    if let Some(parent) = dest.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent).map_err(|e| format!("create_dir: {}", e))?;
        }
    }
    fs::copy(&real_src, dest).map_err(|e| format!("copy: {}", e))?;
    Ok(())
}

#[tauri::command]
pub fn move_files(
    source_paths: Vec<String>,
    destination_folder: String,
    app_handle: AppHandle,
) -> Result<(), String> {
    let dest_path = Path::new(&destination_folder);
    if !dest_path.is_dir() {
        return Err(format!(
            "Destination is not a folder: {}",
            destination_folder
        ));
    }

    let unique_source_images: HashSet<PathBuf> = source_paths
        .iter()
        .map(|p| parse_virtual_path(p).0)
        .collect();

    let mut all_files_to_trash = Vec::new();
    let mut renames = HashMap::new();

    for source_image_path in unique_source_images {
        let source_parent = source_image_path
            .parent()
            .ok_or("Could not get parent directory")?;
        if source_parent == dest_path {
            return Err("Cannot move files into the same folder they are already in.".to_string());
        }

        let files_to_move = find_all_associated_files(&source_image_path)?;

        for file_to_move in &files_to_move {
            if let Some(file_name) = file_to_move.file_name() {
                let dest_file_path = dest_path.join(file_name);
                if dest_file_path.exists() {
                    return Err(format!(
                        "File already exists at destination: {}",
                        dest_file_path.display()
                    ));
                }
            }
        }

        for file_to_move in &files_to_move {
            if let Some(file_name) = file_to_move.file_name() {
                let dest_file_path = dest_path.join(file_name);
                fs::copy(file_to_move, &dest_file_path).map_err(|e| e.to_string())?;
            }
        }

        let dest_image_path = dest_path.join(source_image_path.file_name().unwrap());
        renames.insert(
            source_image_path.to_string_lossy().into_owned(),
            dest_image_path.to_string_lossy().into_owned(),
        );

        all_files_to_trash.extend(files_to_move);
    }

    #[cfg(any(target_os = "windows", target_os = "macos", target_os = "linux"))]
    if !all_files_to_trash.is_empty()
        && let Err(trash_error) = trash::delete_all(&all_files_to_trash)
    {
        log::warn!(
            "Failed to move source files to trash: {}. Falling back to permanent delete.",
            trash_error
        );
        for path in all_files_to_trash {
            if path.is_file() {
                fs::remove_file(&path).map_err(|e| {
                    format!("Failed to delete source file {}: {}", path.display(), e)
                })?;
            }
        }
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    for path in all_files_to_trash {
        if path.is_file() {
            fs::remove_file(&path)
                .map_err(|e| format!("Failed to delete source file {}: {}", path.display(), e))?;
        }
    }

    sync_album_path_changes(&app_handle, Some(&renames), None, None);

    Ok(())
}

#[tauri::command]
pub fn save_metadata_and_update_thumbnail(
    path: String,
    adjustments: Value,
    app_handle: AppHandle,
    state: tauri::State<AppState>,
) -> Result<(), String> {
    let (source_path, sidecar_path) = parse_virtual_path(&path);

    let mut metadata = crate::exif_processing::load_sidecar(&sidecar_path);

    let mut final_adjustments = adjustments;
    {
        let lens_db_guard = state.lens_db.lock().unwrap();
        resolve_lens_params_in_adjustments(
            &mut final_adjustments,
            &metadata.exif,
            lens_db_guard.as_deref(),
        );
    }

    metadata.adjustments = final_adjustments;

    let json_string = serde_json::to_string_pretty(&metadata).map_err(|e| e.to_string())?;
    std::fs::write(&sidecar_path, json_string).map_err(|e| e.to_string())?;

    if let Ok(settings) = load_settings(app_handle.clone())
        && settings.enable_xmp_sync.unwrap_or(false)
    {
        let create_if_missing = settings.create_xmp_if_missing.unwrap_or(false);
        sync_metadata_to_xmp(&source_path, &metadata, create_if_missing);
    }

    let loaded_image_lock = state.original_image.lock().unwrap();
    let preloaded_image_option = if let Some(loaded_image) = loaded_image_lock.as_ref() {
        if loaded_image.path == path {
            Some(loaded_image.image.clone())
        } else {
            None
        }
    } else {
        None
    };
    drop(loaded_image_lock);

    let gpu_context = gpu_processing::get_or_init_gpu_context(&state, &app_handle).ok();
    let app_handle_clone = app_handle.clone();
    let path_clone = path.clone();

    add_to_thumbnail_queue(&state, 1, &app_handle);

    thread::spawn(move || {
        let state = app_handle_clone.state::<AppState>();
        let settings = load_settings(app_handle_clone.clone()).unwrap_or_default();

        let thumb_cache_dir = match resolve_thumbnail_cache_dir(&app_handle_clone) {
            Ok(dir) => dir,
            Err(e) => {
                log::warn!(
                    "Unable to initialize thumbnail cache directory for '{}': {}",
                    path_clone,
                    e
                );
                emit_thumbnail_cache_setup_error(&app_handle_clone, &path_clone, &e);
                increment_thumbnail_progress(&state, &app_handle_clone);
                return;
            }
        };

        let result = generate_single_thumbnail_and_cache(
            &path_clone,
            &thumb_cache_dir,
            gpu_context.as_ref(),
            preloaded_image_option.as_deref(),
            true,
            &app_handle_clone,
            &settings,
        );

        if let Some((thumbnail_path, rating, is_edited)) = result {
            emit_thumbnail_generated(
                &app_handle_clone,
                &path_clone,
                &thumbnail_path,
                rating,
                is_edited,
            );
        }

        increment_thumbnail_progress(&state, &app_handle_clone);
    });

    Ok(())
}

#[tauri::command]
pub async fn apply_adjustments_to_paths(
    paths: Vec<String>,
    adjustments: Value,
    app_handle: AppHandle,
) -> Result<(), String> {
    let state = app_handle.state::<AppState>();
    add_to_thumbnail_queue(&state, paths.len(), &app_handle);

    tauri::async_runtime::spawn_blocking(move || {
        let settings = load_settings(app_handle.clone()).unwrap_or_default();
        let enable_xmp_sync = settings.enable_xmp_sync.unwrap_or(false);
        let create_xmp_if_missing = settings.create_xmp_if_missing.unwrap_or(false);

        let lens_db = app_handle
            .state::<AppState>()
            .lens_db
            .lock()
            .unwrap()
            .clone();

        paths.par_iter().for_each(|path| {
            let (_, sidecar_path) = parse_virtual_path(path);

            let mut existing_metadata = crate::exif_processing::load_sidecar(&sidecar_path);

            let mut new_adjustments = existing_metadata.adjustments;
            if new_adjustments.is_null() {
                new_adjustments = serde_json::json!({});
            }

            if let (Some(new_map), Some(pasted_map)) =
                (new_adjustments.as_object_mut(), adjustments.as_object())
            {
                for (k, v) in pasted_map {
                    new_map.insert(k.clone(), v.clone());
                }
            }

            resolve_lens_params_in_adjustments(
                &mut new_adjustments,
                &existing_metadata.exif,
                lens_db.as_deref(),
            );

            existing_metadata.adjustments = new_adjustments;

            if let Ok(json_string) = serde_json::to_string_pretty(&existing_metadata) {
                let _ = std::fs::write(&sidecar_path, json_string);
            }

            if enable_xmp_sync {
                let source_path = parse_virtual_path(path).0;
                sync_metadata_to_xmp(&source_path, &existing_metadata, create_xmp_if_missing);
            }
        });

        let state = app_handle.state::<AppState>();
        let thumb_cache_dir = match resolve_thumbnail_cache_dir(&app_handle) {
            Ok(dir) => dir,
            Err(e) => {
                log::warn!("Unable to initialize thumbnail cache directory: {}", e);
                for path in &paths {
                    emit_thumbnail_cache_setup_error(&app_handle, path, &e);
                }
                for _ in 0..paths.len() {
                    increment_thumbnail_progress(&state, &app_handle);
                }
                return;
            }
        };

        let gpu_context = gpu_processing::get_or_init_gpu_context(&state, &app_handle).ok();

        paths.par_iter().for_each(|path_str| {
            let result = generate_single_thumbnail_and_cache(
                path_str,
                &thumb_cache_dir,
                gpu_context.as_ref(),
                None,
                true,
                &app_handle,
                &settings,
            );

            if let Some((thumbnail_path, rating, is_edited)) = result {
                emit_thumbnail_generated(&app_handle, path_str, &thumbnail_path, rating, is_edited);
            }

            increment_thumbnail_progress(&state, &app_handle);
        });
    });

    Ok(())
}

/// Apply relative (delta) adjustments to existing develop settings — Lightroom Quick Develop style.
/// Numeric keys are added; missing keys start from 0. Non-numeric keys in `deltas` are ignored.
#[tauri::command]
pub async fn apply_relative_adjustments_to_paths(
    paths: Vec<String>,
    deltas: Value,
    app_handle: AppHandle,
) -> Result<(), String> {
    let state = app_handle.state::<AppState>();
    add_to_thumbnail_queue(&state, paths.len(), &app_handle);

    tauri::async_runtime::spawn_blocking(move || {
        let settings = load_settings(app_handle.clone()).unwrap_or_default();
        let enable_xmp_sync = settings.enable_xmp_sync.unwrap_or(false);
        let create_xmp_if_missing = settings.create_xmp_if_missing.unwrap_or(false);

        let lens_db = app_handle
            .state::<AppState>()
            .lens_db
            .lock()
            .unwrap()
            .clone();

        let delta_map = deltas.as_object().cloned().unwrap_or_default();

        paths.par_iter().for_each(|path| {
            let (_, sidecar_path) = parse_virtual_path(path);
            let mut existing_metadata = crate::exif_processing::load_sidecar(&sidecar_path);

            let mut new_adjustments = existing_metadata.adjustments;
            if new_adjustments.is_null() {
                new_adjustments = serde_json::json!({});
            }

            if let Some(map) = new_adjustments.as_object_mut() {
                for (k, v) in &delta_map {
                    let delta = match v {
                        Value::Number(n) => n.as_f64().unwrap_or(0.0),
                        Value::String(s) => s.parse::<f64>().unwrap_or(0.0),
                        _ => continue,
                    };
                    if delta == 0.0 {
                        continue;
                    }
                    let current = map
                        .get(k)
                        .and_then(|x| x.as_f64())
                        .unwrap_or(0.0);
                    map.insert(k.clone(), serde_json::json!(current + delta));
                }
            }

            resolve_lens_params_in_adjustments(
                &mut new_adjustments,
                &existing_metadata.exif,
                lens_db.as_deref(),
            );

            existing_metadata.adjustments = new_adjustments;

            if let Ok(json_string) = serde_json::to_string_pretty(&existing_metadata) {
                let _ = std::fs::write(&sidecar_path, json_string);
            }

            if enable_xmp_sync {
                let source_path = parse_virtual_path(path).0;
                sync_metadata_to_xmp(&source_path, &existing_metadata, create_xmp_if_missing);
            }
        });

        let state = app_handle.state::<AppState>();
        let thumb_cache_dir = match resolve_thumbnail_cache_dir(&app_handle) {
            Ok(dir) => dir,
            Err(e) => {
                log::warn!("Unable to initialize thumbnail cache directory: {}", e);
                for path in &paths {
                    emit_thumbnail_cache_setup_error(&app_handle, path, &e);
                }
                for _ in 0..paths.len() {
                    increment_thumbnail_progress(&state, &app_handle);
                }
                return;
            }
        };

        let gpu_context = gpu_processing::get_or_init_gpu_context(&state, &app_handle).ok();

        paths.par_iter().for_each(|path_str| {
            let result = generate_single_thumbnail_and_cache(
                path_str,
                &thumb_cache_dir,
                gpu_context.as_ref(),
                None,
                true,
                &app_handle,
                &settings,
            );

            if let Some((thumbnail_path, rating, is_edited)) = result {
                emit_thumbnail_generated(&app_handle, path_str, &thumbnail_path, rating, is_edited);
            }

            increment_thumbnail_progress(&state, &app_handle);
        });
    });

    Ok(())
}

#[tauri::command]
pub async fn reset_adjustments_for_paths(
    paths: Vec<String>,
    app_handle: AppHandle,
) -> Result<(), String> {
    let state = app_handle.state::<AppState>();
    add_to_thumbnail_queue(&state, paths.len(), &app_handle);

    tauri::async_runtime::spawn_blocking(move || {
        let settings = load_settings(app_handle.clone()).unwrap_or_default();
        let enable_xmp_sync = settings.enable_xmp_sync.unwrap_or(false);
        let create_xmp_if_missing = settings.create_xmp_if_missing.unwrap_or(false);

        paths.par_iter().for_each(|path| {
            let (_, sidecar_path) = parse_virtual_path(path);

            let mut existing_metadata = crate::exif_processing::load_sidecar(&sidecar_path);

            existing_metadata.adjustments = serde_json::json!({});

            if let Ok(json_string) = serde_json::to_string_pretty(&existing_metadata) {
                let _ = std::fs::write(&sidecar_path, json_string);
            }

            if enable_xmp_sync {
                let source_path = parse_virtual_path(path).0;
                sync_metadata_to_xmp(&source_path, &existing_metadata, create_xmp_if_missing);
            }
        });

        let state = app_handle.state::<AppState>();
        let thumb_cache_dir = match resolve_thumbnail_cache_dir(&app_handle) {
            Ok(dir) => dir,
            Err(e) => {
                log::warn!("Unable to initialize thumbnail cache directory: {}", e);
                for path in &paths {
                    emit_thumbnail_cache_setup_error(&app_handle, path, &e);
                }
                for _ in 0..paths.len() {
                    increment_thumbnail_progress(&state, &app_handle);
                }
                return;
            }
        };

        let gpu_context = gpu_processing::get_or_init_gpu_context(&state, &app_handle).ok();

        paths.par_iter().for_each(|path_str| {
            let result = generate_single_thumbnail_and_cache(
                path_str,
                &thumb_cache_dir,
                gpu_context.as_ref(),
                None,
                true,
                &app_handle,
                &settings,
            );

            if let Some((thumbnail_path, rating, is_edited)) = result {
                emit_thumbnail_generated(&app_handle, path_str, &thumbnail_path, rating, is_edited);
            }

            increment_thumbnail_progress(&state, &app_handle);
        });
    });

    Ok(())
}

#[tauri::command]
pub async fn apply_auto_adjustments_to_paths(
    paths: Vec<String>,
    app_handle: AppHandle,
) -> Result<(), String> {
    let state = app_handle.state::<AppState>();
    add_to_thumbnail_queue(&state, paths.len(), &app_handle);

    tauri::async_runtime::spawn_blocking(move || {
        let settings = load_settings(app_handle.clone()).unwrap_or_default();
        let enable_xmp_sync = settings.enable_xmp_sync.unwrap_or(false);
        let create_xmp_if_missing = settings.create_xmp_if_missing.unwrap_or(false);

        let state = app_handle.state::<AppState>();
        let thumb_cache_dir = match resolve_thumbnail_cache_dir(&app_handle) {
            Ok(dir) => dir,
            Err(e) => {
                log::warn!("Unable to initialize thumbnail cache directory: {}", e);
                for path in &paths {
                    emit_thumbnail_cache_setup_error(&app_handle, path, &e);
                }
                for _ in 0..paths.len() {
                    increment_thumbnail_progress(&state, &app_handle);
                }
                return;
            }
        };

        let gpu_context = gpu_processing::get_or_init_gpu_context(&state, &app_handle).ok();

        paths.par_iter().for_each(|path| {
            let loaded_image: Option<DynamicImage> = (|| -> Result<DynamicImage, String> {
                let (source_path, sidecar_path) = parse_virtual_path(path);
                let source_path_str = source_path.to_string_lossy().to_string();

                let file_bytes = fs::read(&source_path).map_err(|e| e.to_string())?;
                let image = image_loader::load_base_image_from_bytes(
                    &file_bytes,
                    &source_path_str,
                    true,
                    &settings,
                    None,
                )
                .map_err(|e| e.to_string())?;

                let auto_results = perform_auto_analysis(&image);
                let auto_adjustments_json = auto_results_to_json(&auto_results);

                let mut existing_metadata = crate::exif_processing::load_sidecar(&sidecar_path);

                if existing_metadata.adjustments.is_null() {
                    existing_metadata.adjustments = serde_json::json!({});
                }

                if let (Some(existing_map), Some(auto_map)) = (
                    existing_metadata.adjustments.as_object_mut(),
                    auto_adjustments_json.as_object(),
                ) {
                    for (k, v) in auto_map {
                        if k == "sectionVisibility" {
                            if let Some(existing_vis_val) = existing_map.get_mut(k) {
                                if let (Some(existing_vis), Some(auto_vis)) =
                                    (existing_vis_val.as_object_mut(), v.as_object())
                                {
                                    for (vis_k, vis_v) in auto_vis {
                                        existing_vis.insert(vis_k.clone(), vis_v.clone());
                                    }
                                }
                            } else {
                                existing_map.insert(k.clone(), v.clone());
                            }
                        } else {
                            existing_map.insert(k.clone(), v.clone());
                        }
                    }
                }

                if let Ok(json_string) = serde_json::to_string_pretty(&existing_metadata) {
                    let _ = std::fs::write(&sidecar_path, json_string);
                }

                if enable_xmp_sync {
                    sync_metadata_to_xmp(&source_path, &existing_metadata, create_xmp_if_missing);
                }
                Ok(image)
            })()
            .map_err(|e| eprintln!("Failed to apply auto adjustments to {}: {}", path, e))
            .ok();

            let result = generate_single_thumbnail_and_cache(
                path,
                &thumb_cache_dir,
                gpu_context.as_ref(),
                loaded_image.as_ref(),
                true,
                &app_handle,
                &settings,
            );

            if let Some((thumbnail_path, rating, is_edited)) = result {
                emit_thumbnail_generated(&app_handle, path, &thumbnail_path, rating, is_edited);
            }

            increment_thumbnail_progress(&state, &app_handle);
        });
    });

    Ok(())
}

#[tauri::command]
pub fn set_color_label_for_paths(
    paths: Vec<String>,
    color: Option<String>,
    app_handle: AppHandle,
) -> Result<(), String> {
    let settings = load_settings(app_handle.clone()).unwrap_or_default();
    let enable_xmp_sync = settings.enable_xmp_sync.unwrap_or(false);
    let create_xmp_if_missing = settings.create_xmp_if_missing.unwrap_or(false);

    paths.par_iter().for_each(|path| {
        let (_, sidecar_path) = parse_virtual_path(path);

        let mut metadata = crate::exif_processing::load_sidecar(&sidecar_path);

        let mut tags = metadata.tags.unwrap_or_default();
        tags.retain(|tag| !tag.starts_with(COLOR_TAG_PREFIX));

        if let Some(c) = &color
            && !c.is_empty()
        {
            tags.push(format!("{}{}", COLOR_TAG_PREFIX, c));
        }

        if tags.is_empty() {
            metadata.tags = None;
        } else {
            metadata.tags = Some(tags);
        }

        if let Ok(json_string) = serde_json::to_string_pretty(&metadata) {
            let _ = std::fs::write(&sidecar_path, json_string);
        }

        if enable_xmp_sync {
            let source_path = parse_virtual_path(path).0;
            sync_metadata_to_xmp(&source_path, &metadata, create_xmp_if_missing);
        }
    });

    Ok(())
}

#[tauri::command]
pub fn set_rating_for_paths(
    paths: Vec<String>,
    rating: u8,
    app_handle: AppHandle,
) -> Result<(), String> {
    let settings = load_settings(app_handle.clone()).unwrap_or_default();
    let enable_xmp_sync = settings.enable_xmp_sync.unwrap_or(false);
    let create_xmp_if_missing = settings.create_xmp_if_missing.unwrap_or(false);

    paths.par_iter().for_each(|path| {
        let (_, sidecar_path) = parse_virtual_path(path);

        let mut metadata = crate::exif_processing::load_sidecar(&sidecar_path);

        metadata.rating = rating;

        if let Ok(json_string) = serde_json::to_string_pretty(&metadata) {
            let _ = std::fs::write(&sidecar_path, json_string);
        }

        if enable_xmp_sync {
            let source_path = parse_virtual_path(path).0;
            sync_metadata_to_xmp(&source_path, &metadata, create_xmp_if_missing);
        }
    });

    Ok(())
}
/// Write UTF-8 text to an absolute path (used for Web gallery HTML export, etc.).
#[tauri::command]
pub fn write_text_file(path: String, contents: String) -> Result<(), String> {
    let p = std::path::Path::new(&path);
    if let Some(parent) = p.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent).map_err(|e| format!("create_dir: {}", e))?;
        }
    }
    fs::write(p, contents.as_bytes()).map_err(|e| format!("write: {}", e))?;
    Ok(())
}

#[tauri::command]
pub fn set_flag_for_paths(
    paths: Vec<String>,
    flag: Option<String>,
    app_handle: AppHandle,
) -> Result<(), String> {
    let settings = load_settings(app_handle.clone()).unwrap_or_default();
    let enable_xmp_sync = settings.enable_xmp_sync.unwrap_or(false);
    let create_xmp_if_missing = settings.create_xmp_if_missing.unwrap_or(false);

    let flag_norm = flag
        .as_ref()
        .map(|s| s.trim().to_lowercase())
        .filter(|s| !s.is_empty());

    paths.par_iter().for_each(|path| {
        let (source_path, sidecar_path) = parse_virtual_path(path);
        let mut metadata = crate::exif_processing::load_sidecar(&sidecar_path);
        let mut tags = metadata.tags.unwrap_or_default();
        tags.retain(|tag| !tag.starts_with("flag:"));
        if let Some(f) = &flag_norm {
            if f == "pick" || f == "reject" {
                tags.push(format!("flag:{}", f));
            }
        }
        metadata.tags = if tags.is_empty() { None } else { Some(tags) };
        if let Ok(json_string) = serde_json::to_string_pretty(&metadata) {
            let _ = std::fs::write(&sidecar_path, json_string);
        }
        if enable_xmp_sync {
            sync_metadata_to_xmp(&source_path, &metadata, create_xmp_if_missing);
        }
    });
    Ok(())
}


#[tauri::command]
pub fn load_metadata(path: String, app_handle: AppHandle) -> Result<ImageMetadata, String> {
    let settings = load_settings(app_handle).unwrap_or_default();
    let enable_xmp_sync = settings.enable_xmp_sync.unwrap_or(false);

    let (source_path, sidecar_path) = parse_virtual_path(&path);
    let mut metadata = crate::exif_processing::load_sidecar(&sidecar_path);

    // Always pull develop settings from a sibling .xmp when the RR sidecar is empty
    // (export Original writes that sidecar; Lightroom-style discovery).
    if sync_metadata_from_xmp(&source_path, &mut metadata)
        && let Ok(json) = serde_json::to_string_pretty(&metadata)
    {
        let _ = fs::write(&sidecar_path, json);
    }
    let _ = enable_xmp_sync;

    Ok(metadata)
}

/// Persist develop snapshots into the image sidecar without regenerating thumbnails.
#[tauri::command]
pub fn save_image_snapshots(path: String, snapshots: Value) -> Result<(), String> {
    let (_source_path, sidecar_path) = parse_virtual_path(&path);
    let mut metadata = crate::exif_processing::load_sidecar(&sidecar_path);
    metadata.snapshots = if snapshots.is_null() {
        None
    } else {
        Some(snapshots)
    };
    let json_string = serde_json::to_string_pretty(&metadata).map_err(|e| e.to_string())?;
    std::fs::write(&sidecar_path, json_string).map_err(|e| e.to_string())?;
    Ok(())
}

/// Export a single develop preset (name + adjustments JSON) to a Lightroom-compatible .xmp file.
#[tauri::command]
pub fn export_preset_to_xmp(
    name: String,
    adjustments: Value,
    file_path: String,
    group: Option<String>,
) -> Result<(), String> {
    let xmp = preset_converter::convert_adjustments_to_xmp_with_group(
        &name,
        &adjustments,
        group.as_deref(),
    );
    fs::write(&file_path, xmp).map_err(|e| format!("Failed to write XMP: {}", e))?;
    Ok(())
}

/// Force-reload develop adjustments from the photo's Lightroom `.xmp` sidecar into the RR sidecar.
/// Overwrites existing RapidRAW develop settings (user-initiated).
#[tauri::command]
fn reimport_develop_from_xmp_path_inner(path: &str) -> Result<Value, String> {
    let (source_path, sidecar_path) = parse_virtual_path(path);
    let xmp_path = resolve_xmp_path(&source_path)
        .ok_or_else(|| format!("No XMP sidecar found for {}", source_path.display()))?;
    let content = fs::read_to_string(&xmp_path)
        .map_err(|e| format!("Failed to read XMP: {}", e))?;
    let looks_like_develop = content.contains("crs:")
        && (content.contains("HasSettings")
            || content.contains("Exposure2012")
            || content.contains("ToneCurvePV2012")
            || content.contains("Highlights2012")
            || content.contains("ConvertToGrayscale"));
    if !looks_like_develop {
        return Err("XMP sidecar has no develop (crs) settings".to_string());
    }
    let preset = preset_converter::convert_xmp_to_preset(&content)?;
    let mut metadata = crate::exif_processing::load_sidecar(&sidecar_path);
    // Keep rating/tags from existing RR sidecar when present
    let rating = metadata.rating;
    let tags = metadata.tags.clone();
    metadata.adjustments = preset.adjustments.clone();
    if rating > 0 {
        if let Some(obj) = metadata.adjustments.as_object_mut() {
            obj.insert("rating".to_string(), serde_json::json!(rating));
        }
    }
    if tags.is_some() {
        metadata.tags = tags;
    }
    let json_string = serde_json::to_string_pretty(&metadata).map_err(|e| e.to_string())?;
    fs::write(&sidecar_path, json_string).map_err(|e| e.to_string())?;
    Ok(preset.adjustments)
}

#[tauri::command]
pub fn reimport_develop_from_xmp(path: String, _app_handle: AppHandle) -> Result<Value, String> {
    reimport_develop_from_xmp_path_inner(&path)
}

/// Batch reimport develop settings from photo XMP sidecars. Returns {ok, fail, errors}.
#[tauri::command]
pub fn reimport_develop_from_xmp_paths(paths: Vec<String>) -> Result<Value, String> {
    let mut ok = 0usize;
    let mut fail = 0usize;
    let mut ok_paths: Vec<String> = Vec::new();
    let mut errors: Vec<String> = Vec::new();
    for path in paths {
        match reimport_develop_from_xmp_path_inner(&path) {
            Ok(_) => {
                ok += 1;
                ok_paths.push(path);
            }
            Err(e) => {
                fail += 1;
                if errors.len() < 8 {
                    errors.push(format!("{}: {}", path, e));
                }
            }
        }
    }
    Ok(serde_json::json!({ "ok": ok, "fail": fail, "okPaths": ok_paths, "errors": errors }))
}

/// Export many presets as individual .xmp files into a directory (sanitized filenames).
#[tauri::command]
pub fn export_presets_to_xmp_directory(
    presets: Vec<Preset>,
    directory: String,
) -> Result<usize, String> {
    let dir = PathBuf::from(&directory);
    if !dir.is_dir() {
        fs::create_dir_all(&dir).map_err(|e| format!("Failed to create directory: {}", e))?;
    }
    let mut count = 0usize;
    for preset in presets {
        let mut safe: String = preset
            .name
            .chars()
            .map(|c| match c {
                '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
                c => c,
            })
            .collect();
        if safe.trim().is_empty() {
            safe = format!("preset_{}", count + 1);
        }
        let mut path = dir.join(format!("{}.xmp", safe));
        let mut n = 1u32;
        while path.exists() {
            path = dir.join(format!("{} ({}).xmp", safe, n));
            n += 1;
        }
        let xmp = preset_converter::convert_adjustments_to_xmp_with_group(
            &preset.name,
            &preset.adjustments,
            preset.group.as_deref(),
        );
        fs::write(&path, xmp).map_err(|e| format!("Failed to write {}: {}", path.display(), e))?;
        count += 1;
    }
    Ok(count)
}


fn get_presets_path(app_handle: &AppHandle) -> Result<std::path::PathBuf, String> {
    let presets_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("presets");

    if !presets_dir.exists() {
        fs::create_dir_all(&presets_dir).map_err(|e| e.to_string())?;
    }

    Ok(presets_dir.join("presets.json"))
}

#[tauri::command]
pub fn load_presets(app_handle: AppHandle) -> Result<Vec<PresetItem>, String> {
    let path = get_presets_path(&app_handle)?;
    if !path.exists() {
        return Ok(Vec::new());
    }
    let content = fs::read_to_string(path).map_err(|e| e.to_string())?;
    serde_json::from_str(&content).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_presets(presets: Vec<PresetItem>, app_handle: AppHandle) -> Result<(), String> {
    let path = get_presets_path(&app_handle)?;
    let json_string = serde_json::to_string_pretty(&presets).map_err(|e| e.to_string())?;
    fs::write(path, json_string).map_err(|e| e.to_string())
}

fn get_internal_library_root_path(app_handle: &AppHandle) -> Result<std::path::PathBuf, String> {
    #[cfg(not(target_os = "android"))]
    {
        let library_dir = app_handle
            .path()
            .app_data_dir()
            .map_err(|e| e.to_string())?
            .join("library");

        if !library_dir.exists() {
            fs::create_dir_all(&library_dir).map_err(|e| e.to_string())?;
        }
        Ok(library_dir)
    }
    #[cfg(target_os = "android")]
    {
        crate::android_integration::get_android_internal_library_root()
    }
}

#[tauri::command]
pub fn get_or_create_internal_library_root(app_handle: AppHandle) -> Result<String, String> {
    let library_root = get_internal_library_root_path(&app_handle)?;

    Ok(library_root.to_string_lossy().to_string())
}

#[tauri::command]
pub fn handle_import_presets_from_file(
    file_path: String,
    app_handle: AppHandle,
) -> Result<Vec<PresetItem>, String> {
    let content =
        fs::read_to_string(file_path).map_err(|e| format!("Failed to read preset file: {}", e))?;
    let imported_preset_file: PresetFile = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse preset file: {}", e))?;

    let mut current_presets = load_presets(app_handle.clone())?;

    let mut current_names: HashSet<String> = current_presets
        .iter()
        .map(|item| match item {
            PresetItem::Preset(p) => p.name.clone(),
            PresetItem::Folder(f) => f.name.clone(),
        })
        .collect();

    for mut imported_item in imported_preset_file.presets {
        let (current_name, _new_id) = match &mut imported_item {
            PresetItem::Preset(p) => {
                p.id = Uuid::new_v4().to_string();
                (p.name.clone(), p.id.clone())
            }
            PresetItem::Folder(f) => {
                f.id = Uuid::new_v4().to_string();
                for child in &mut f.children {
                    child.id = Uuid::new_v4().to_string();
                }
                (f.name.clone(), f.id.clone())
            }
        };

        let mut new_name = current_name.clone();
        let mut counter = 1;
        while current_names.contains(&new_name) {
            new_name = format!("{} ({})", current_name, counter);
            counter += 1;
        }

        match &mut imported_item {
            PresetItem::Preset(p) => p.name = new_name.clone(),
            PresetItem::Folder(f) => f.name = new_name.clone(),
        }

        current_names.insert(new_name);
        current_presets.push(imported_item);
    }

    save_presets(current_presets.clone(), app_handle)?;
    Ok(current_presets)
}

fn collect_preset_names(presets: &[PresetItem]) -> HashSet<String> {
    presets
        .iter()
        .flat_map(|item| match item {
            PresetItem::Preset(p) => vec![p.name.clone()],
            PresetItem::Folder(f) => {
                let mut names = vec![f.name.clone()];
                names.extend(f.children.iter().map(|c| c.name.clone()));
                names
            }
        })
        .collect()
}

fn unique_preset_name(base: &str, used: &HashSet<String>) -> String {
    let mut new_name = base.to_string();
    let mut counter = 1;
    while used.contains(&new_name) {
        new_name = format!("{} ({})", base, counter);
        counter += 1;
    }
    new_name
}

fn read_xmp_or_lrtemplate(file_path: &str) -> Result<String, String> {
    let content = fs::read_to_string(file_path)
        .map_err(|e| format!("Failed to read legacy preset file: {}", e))?;

    if file_path.to_lowercase().ends_with(".lrtemplate") {
        let re = Regex::new(r#"(?s)s.xmp = "(.*)""#).unwrap();
        if let Some(caps) = re.captures(&content) {
            Ok(caps
                .get(1)
                .map(|m| m.as_str().replace(r#"\""#, r#"""#))
                .unwrap_or(content))
        } else {
            Ok(content)
        }
    } else {
        Ok(content)
    }
}

/// Insert a converted XMP preset into the list, honouring Lightroom group folders.
fn insert_converted_xmp_preset(
    current_presets: &mut Vec<PresetItem>,
    mut preset: Preset,
    group: Option<String>,
) {
    let mut used_names = collect_preset_names(current_presets);
    preset.name = unique_preset_name(&preset.name, &used_names);
    used_names.insert(preset.name.clone());

    if let Some(group_name) = group.filter(|g| !g.trim().is_empty()) {
        // Find existing folder with same name
        if let Some(PresetItem::Folder(folder)) = current_presets.iter_mut().find(|item| {
            matches!(item, PresetItem::Folder(f) if f.name == group_name)
        }) {
            // Avoid duplicate child names inside folder
            let child_names: HashSet<String> = folder.children.iter().map(|c| c.name.clone()).collect();
            preset.name = unique_preset_name(&preset.name, &child_names);
            folder.children.push(preset);
            return;
        }

        // Create new folder
        let folder = PresetFolder {
            id: Uuid::new_v4().to_string(),
            name: group_name,
            children: vec![preset],
        };
        current_presets.push(PresetItem::Folder(folder));
        return;
    }

    current_presets.push(PresetItem::Preset(preset));
}

#[tauri::command]
pub fn handle_import_legacy_presets_from_file(
    file_path: String,
    app_handle: AppHandle,
) -> Result<Vec<PresetItem>, String> {
    let xmp_content = read_xmp_or_lrtemplate(&file_path)?;
    let converted = preset_converter::convert_xmp_to_preset_with_group(&xmp_content)?;

    let mut current_presets = load_presets(app_handle.clone())?;
    insert_converted_xmp_preset(&mut current_presets, converted.preset, converted.group);

    save_presets(current_presets.clone(), app_handle)?;
    Ok(current_presets)
}

/// Import multiple Lightroom XMP / lrtemplate files at once (paths can be files).
#[tauri::command]
pub fn handle_import_legacy_presets_from_paths(
    file_paths: Vec<String>,
    app_handle: AppHandle,
) -> Result<Vec<PresetItem>, String> {
    if file_paths.is_empty() {
        return Err("No preset files provided".to_string());
    }

    let mut current_presets = load_presets(app_handle.clone())?;
    let mut errors: Vec<String> = Vec::new();
    let mut imported = 0usize;

    for path in file_paths {
        let lower = path.to_lowercase();
        if !(lower.ends_with(".xmp") || lower.ends_with(".lrtemplate")) {
            errors.push(format!("Skipped unsupported file: {}", path));
            continue;
        }
        match read_xmp_or_lrtemplate(&path)
            .and_then(|xmp| preset_converter::convert_xmp_to_preset_with_group(&xmp))
        {
            Ok(converted) => {
                insert_converted_xmp_preset(
                    &mut current_presets,
                    converted.preset,
                    converted.group,
                );
                imported += 1;
            }
            Err(e) => errors.push(format!("{}: {}", path, e)),
        }
    }

    if imported == 0 {
        return Err(if errors.is_empty() {
            "No presets imported".to_string()
        } else {
            errors.join("; ")
        });
    }

    save_presets(current_presets.clone(), app_handle)?;
    if !errors.is_empty() {
        log::warn!("Partial preset import: {}", errors.join("; "));
    }
    Ok(current_presets)
}

/// Recursively import all .xmp / .lrtemplate develop presets from a directory
/// (e.g. Adobe CameraRaw Settings / ImportedSettings).
#[tauri::command]
pub fn handle_import_legacy_presets_from_directory(
    directory: String,
    app_handle: AppHandle,
) -> Result<Vec<PresetItem>, String> {
    let root = PathBuf::from(&directory);
    if !root.is_dir() {
        return Err(format!("Not a directory: {}", directory));
    }

    let mut file_paths: Vec<String> = WalkDir::new(&root)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
        .filter_map(|e| {
            let p = e.path();
            let ext = p
                .extension()
                .and_then(|s| s.to_str())
                .unwrap_or("")
                .to_lowercase();
            if ext == "xmp" || ext == "lrtemplate" {
                Some(p.to_string_lossy().to_string())
            } else {
                None
            }
        })
        .collect();

    file_paths.sort();
    if file_paths.is_empty() {
        return Err(format!(
            "No .xmp or .lrtemplate files found in {}",
            directory
        ));
    }

    handle_import_legacy_presets_from_paths(file_paths, app_handle)
}

/// Parse Lightroom .xmp / .lrtemplate presets (files or folders, recursive) WITHOUT saving them.
/// Returns `{ presets: [Preset (group = crs:Group)], errors: [String] }`.
#[tauri::command]
pub fn parse_legacy_preset_files(paths: Vec<String>) -> Result<Value, String> {
    let is_legacy = |p: &Path| {
        let ext = p.extension().and_then(|s| s.to_str()).unwrap_or("").to_lowercase();
        ext == "xmp" || ext == "lrtemplate"
    };
    let mut files: Vec<PathBuf> = Vec::new();
    for path in paths {
        let p = PathBuf::from(&path);
        if p.is_dir() {
            let mut found: Vec<PathBuf> = WalkDir::new(&p)
                .into_iter()
                .filter_map(|e| e.ok())
                .filter(|e| e.file_type().is_file() && is_legacy(e.path()))
                .map(|e| e.path().to_path_buf())
                .collect();
            found.sort();
            files.extend(found);
        } else if is_legacy(&p) {
            files.push(p);
        }
    }
    let mut presets: Vec<Preset> = Vec::new();
    let mut errors: Vec<String> = Vec::new();
    for file in files {
        let file_str = file.to_string_lossy().to_string();
        match read_xmp_or_lrtemplate(&file_str)
            .and_then(|xmp| preset_converter::convert_xmp_to_preset_with_group(&xmp))
        {
            Ok(converted) => {
                let mut preset = converted.preset;
                preset.group = converted.group.filter(|g| !g.trim().is_empty());
                presets.push(preset);
            }
            Err(e) => errors.push(format!("{}: {}", file_str, e)),
        }
    }
    Ok(serde_json::json!({ "presets": presets, "errors": errors }))
}

#[tauri::command]
pub fn handle_export_presets_to_file(
    presets_to_export: Vec<PresetItem>,
    file_path: String,
) -> Result<(), String> {
    let preset_file = ExportPresetFile {
        creator: "Anonymous",
        presets: &presets_to_export,
    };

    let json_string = serde_json::to_string_pretty(&preset_file)
        .map_err(|e| format!("Failed to serialize presets: {}", e))?;
    fs::write(file_path, json_string).map_err(|e| format!("Failed to write preset file: {}", e))
}

#[tauri::command]
pub fn save_community_preset(
    name: String,
    adjustments: Value,
    app_handle: AppHandle,
    include_masks: Option<bool>,
    include_crop_transform: Option<bool>,
    preset_type: Option<String>,
) -> Result<(), String> {
    let mut current_presets = load_presets(app_handle.clone())?;

    let community_folder_name = "Community";
    let community_folder_id = match current_presets.iter_mut().find(|item| {
        if let PresetItem::Folder(f) = item {
            f.name == community_folder_name
        } else {
            false
        }
    }) {
        Some(PresetItem::Folder(folder)) => folder.id.clone(),
        _ => {
            let new_folder_id = Uuid::new_v4().to_string();
            let new_folder = PresetItem::Folder(PresetFolder {
                id: new_folder_id.clone(),
                name: community_folder_name.to_string(),
                children: Vec::new(),
            });
            current_presets.insert(0, new_folder);
            new_folder_id
        }
    };

    let new_preset = Preset {
        id: Uuid::new_v4().to_string(),
        name,
        adjustments,
        include_masks,
        include_crop_transform,
        preset_type: preset_type.or(Some("style".to_string())),
        group: None,
    };

    if let Some(PresetItem::Folder(folder)) = current_presets.iter_mut().find(|item| {
        if let PresetItem::Folder(f) = item {
            f.id == community_folder_id
        } else {
            false
        }
    }) {
        folder.children.retain(|p| p.name != new_preset.name);
        folder.children.push(new_preset);
    }

    save_presets(current_presets, app_handle)
}

#[tauri::command]
pub fn clear_all_sidecars(root_path: String) -> Result<usize, String> {
    if !Path::new(&root_path).exists() {
        return Err(format!("Root path does not exist: {}", root_path));
    }

    let mut deleted_count = 0;
    let walker = WalkDir::new(root_path).into_iter();

    for entry in walker.filter_map(|e| e.ok()) {
        let path = entry.path();
        if path.is_file()
            && let Some(extension) = path.extension()
            && (extension == "rrdata" || extension == "rrexif")
        {
            if fs::remove_file(path).is_ok() {
                deleted_count += 1;
            } else {
                eprintln!("Failed to delete sidecar file: {:?}", path);
            }
        }
    }

    Ok(deleted_count)
}

#[tauri::command]
pub fn clear_thumbnail_cache(app_handle: AppHandle) -> Result<(), String> {
    let cache_dir = app_handle
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?;
    let thumb_cache_dir = cache_dir.join("thumbnails");

    if thumb_cache_dir.exists() {
        fs::remove_dir_all(&thumb_cache_dir)
            .map_err(|e| format!("Failed to remove thumbnail cache: {}", e))?;
    }

    fs::create_dir_all(&thumb_cache_dir)
        .map_err(|e| format!("Failed to recreate thumbnail cache directory: {}", e))?;

    Ok(())
}

#[tauri::command]
pub fn show_in_finder(path: String) -> Result<(), String> {
    let (source_path, _) = parse_virtual_path(&path);

    #[cfg(target_os = "windows")]
    {
        let source_path_str = source_path.to_string_lossy().to_string();
        Command::new("explorer")
            .args(["/select,", &source_path_str])
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "macos")]
    {
        let source_path_str = source_path.to_string_lossy().to_string();
        Command::new("open")
            .args(["-R", &source_path_str])
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "linux")]
    {
        if let Some(parent) = source_path.parent() {
            Command::new("xdg-open")
                .arg(parent)
                .spawn()
                .map_err(|e| e.to_string())?;
        } else {
            return Err("Could not get parent directory".into());
        }
    }

    #[cfg(target_os = "android")]
    {
        return Err("Show in File Manager is not natively supported via CLI on Android.".into());
    }

    #[cfg(target_os = "ios")]
    {
        return Err("Show in File Manager is not supported on iOS.".into());
    }

    Ok(())
}

/// Reveal the Lightroom/Adobe `.xmp` sidecar next to an image, if present.
#[tauri::command]
pub fn show_xmp_sidecar(path: String) -> Result<(), String> {
    let (source_path, _) = parse_virtual_path(&path);
    let xmp = resolve_xmp_path(&source_path)
        .ok_or_else(|| format!("No XMP sidecar found for {}", source_path.display()))?;
    show_in_finder(xmp.to_string_lossy().to_string())
}

/// Force-write current RapidRAW develop adjustments (+ rating/tags) into the photo `.xmp` sidecar.
/// Optional `adjustments` override the RR sidecar (used when the open editor has unsaved slider state).
#[tauri::command]
pub fn export_develop_to_xmp(
    path: String,
    adjustments: Option<Value>,
    _app_handle: AppHandle,
) -> Result<(), String> {
    let (source_path, sidecar_path) = parse_virtual_path(&path);
    let mut metadata = crate::exif_processing::load_sidecar(&sidecar_path);
    if let Some(adj) = adjustments {
        metadata.adjustments = adj;
    }
    // Explicit user action always creates a missing sidecar
    sync_metadata_to_xmp(&source_path, &metadata, true);
    if resolve_xmp_path(&source_path).is_none() {
        return Err("Failed to write XMP sidecar".to_string());
    }
    let _ = sidecar_path;
    Ok(())
}


#[tauri::command]
pub fn delete_files_from_disk(paths: Vec<String>, app_handle: AppHandle) -> Result<(), String> {
    let mut files_to_trash = HashSet::new();

    let mut deletions = HashSet::new();

    for path_str in paths {
        let (source_path, sidecar_path) = parse_virtual_path(&path_str);
        deletions.insert(path_str.clone());

        if path_str.contains("?vc=") {
            if sidecar_path.exists() {
                files_to_trash.insert(sidecar_path);
            }
        } else {
            if source_path.exists() {
                match find_all_associated_files(&source_path) {
                    Ok(associated_files) => {
                        for file in associated_files {
                            files_to_trash.insert(file);
                        }
                    }
                    Err(e) => {
                        log::warn!(
                            "Could not find associated files for {}: {}",
                            source_path.display(),
                            e
                        );
                    }
                }
            }
        }
    }

    if files_to_trash.is_empty() {
        return Ok(());
    }

    let final_paths_to_delete: Vec<PathBuf> = files_to_trash.into_iter().collect();
    #[cfg(any(target_os = "windows", target_os = "macos", target_os = "linux"))]
    if let Err(trash_error) = trash::delete_all(&final_paths_to_delete) {
        log::warn!(
            "Failed to move files to trash: {}. Falling back to permanent delete.",
            trash_error
        );
        for path in final_paths_to_delete {
            if path.is_file() {
                fs::remove_file(&path)
                    .map_err(|e| format!("Failed to delete file {}: {}", path.display(), e))?;
            } else if path.is_dir() {
                fs::remove_dir_all(&path)
                    .map_err(|e| format!("Failed to delete directory {}: {}", path.display(), e))?;
            }
        }
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    for path in final_paths_to_delete {
        if path.is_file() {
            fs::remove_file(&path)
                .map_err(|e| format!("Failed to delete file {}: {}", path.display(), e))?;
        } else if path.is_dir() {
            fs::remove_dir_all(&path)
                .map_err(|e| format!("Failed to delete directory {}: {}", path.display(), e))?;
        }
    }

    sync_album_path_changes(&app_handle, None, Some(&deletions), None);

    Ok(())
}

fn deletion_stem_for(filename: &str) -> Option<&str> {
    let image_filename = if filename.ends_with(".rrdata") {
        let without_rrdata = filename.trim_end_matches(".rrdata");
        if let Some(dot_pos) = without_rrdata.rfind('.') {
            let suffix = &without_rrdata[dot_pos + 1..];
            if suffix.len() == 6 && suffix.chars().all(|c| c.is_ascii_hexdigit()) {
                &without_rrdata[..dot_pos]
            } else {
                without_rrdata
            }
        } else {
            without_rrdata
        }
    } else if filename.ends_with(".rrexif") {
        filename.trim_end_matches(".rrexif")
    } else if is_supported_image_file(filename) {
        filename
    } else {
        return None;
    };
    Path::new(image_filename)
        .file_stem()
        .and_then(|s| s.to_str())
}

#[tauri::command]
pub fn delete_files_with_associated(
    paths: Vec<String>,
    app_handle: AppHandle,
) -> Result<(), String> {
    if paths.is_empty() {
        return Ok(());
    }

    let mut stems_to_delete = HashSet::new();
    let mut parent_dirs = HashSet::new();
    let mut deletions = HashSet::new();

    for path_str in &paths {
        deletions.insert(path_str.clone());
        let (source_path, _) = parse_virtual_path(path_str);
        if let Some(stem) = source_path.file_stem().and_then(|s| s.to_str()) {
            stems_to_delete.insert(stem.to_string());
        }
        if let Some(parent) = source_path.parent() {
            parent_dirs.insert(parent.to_path_buf());
        }
    }

    if stems_to_delete.is_empty() {
        return Ok(());
    }

    let mut files_to_trash = HashSet::new();

    for parent_dir in parent_dirs {
        if let Ok(entries) = fs::read_dir(parent_dir) {
            for entry in entries.filter_map(Result::ok) {
                let entry_path = entry.path();
                if !entry_path.is_file() {
                    continue;
                }

                let entry_filename = entry.file_name();
                let entry_filename_str = entry_filename.to_string_lossy();

                if let Some(stem) = deletion_stem_for(&entry_filename_str)
                    && stems_to_delete.contains(stem)
                {
                    files_to_trash.insert(entry_path);
                }
            }
        }
    }

    if files_to_trash.is_empty() {
        return Ok(());
    }

    let final_paths_to_delete: Vec<PathBuf> = files_to_trash.into_iter().collect();
    #[cfg(any(target_os = "windows", target_os = "macos", target_os = "linux"))]
    if let Err(trash_error) = trash::delete_all(&final_paths_to_delete) {
        log::warn!(
            "Failed to move files to trash: {}. Falling back to permanent delete.",
            trash_error
        );
        for path in final_paths_to_delete {
            if path.is_file() {
                fs::remove_file(&path)
                    .map_err(|e| format!("Failed to delete file {}: {}", path.display(), e))?;
            }
        }
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    for path in final_paths_to_delete {
        if path.is_file() {
            fs::remove_file(&path)
                .map_err(|e| format!("Failed to delete file {}: {}", path.display(), e))?;
        }
    }

    sync_album_path_changes(&app_handle, None, Some(&deletions), None);

    Ok(())
}

pub fn get_thumb_cache_dir(app_handle: &AppHandle) -> Result<PathBuf, String> {
    let cache_dir = app_handle
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?;
    let thumb_cache_dir = cache_dir.join("thumbnails");
    if !thumb_cache_dir.exists() {
        fs::create_dir_all(&thumb_cache_dir).map_err(|e| e.to_string())?;
    }
    Ok(thumb_cache_dir)
}

pub fn get_cache_key_hash(path_str: &str) -> Option<String> {
    let (_, sidecar_path) = parse_virtual_path(path_str);

    let adjustments_bytes = if let Ok(content) = fs::read_to_string(&sidecar_path) {
        if let Ok(meta) = serde_json::from_str::<ImageMetadata>(&content) {
            serde_json::to_vec(&meta.adjustments).unwrap_or_default()
        } else {
            Vec::new()
        }
    } else {
        Vec::new()
    };

    compute_thumbnail_cache_hash(path_str, &adjustments_bytes)
}

pub fn get_cached_or_generate_thumbnail_image(
    path_str: &str,
    app_handle: &AppHandle,
    gpu_context: Option<&GpuContext>,
) -> Result<DynamicImage> {
    let thumb_cache_dir = get_thumb_cache_dir(app_handle).map_err(|e| anyhow::anyhow!(e))?;
    let settings = load_settings(app_handle.clone()).unwrap_or_default();
    let target_width = settings.thumbnail_resolution.unwrap_or(720);

    if let Some(cache_hash) = get_cache_key_hash(path_str) {
        let cache_filename = format!("{}.jpg", cache_hash);
        let cache_path = thumb_cache_dir.join(cache_filename);

        if cache_path.exists() {
            if let Ok(image) = image::open(&cache_path) {
                return Ok(image);
            }
            eprintln!(
                "Could not open cached thumbnail, regenerating: {:?}",
                cache_path
            );
        }

        let thumb_image = generate_thumbnail_data(path_str, gpu_context, None, app_handle)?;
        let thumb_data = encode_thumbnail(&thumb_image, target_width)?;
        fs::write(&cache_path, &thumb_data)?;

        Ok(thumb_image)
    } else {
        generate_thumbnail_data(path_str, gpu_context, None, app_handle)
    }
}

#[tauri::command]
pub async fn import_files(
    source_paths: Vec<String>,
    destination_folder: String,
    settings: ImportSettings,
    app_handle: AppHandle,
) -> Result<(), String> {
    let source_paths = prefer_raw_over_jpeg(source_paths);
    let total_files = source_paths.len();
    let _ = app_handle.emit("import-start", serde_json::json!({ "total": total_files }));

    tauri::async_runtime::spawn_blocking(move || {
        let mut imported_paths: Vec<String> = Vec::new();
        let mut dng_passthrough: usize = 0;
        let mut dng_deferred: usize = 0;
        for (i, source_path_str) in source_paths.iter().enumerate() {
            let _ = app_handle.emit(
                "import-progress",
                serde_json::json!({ "current": i, "total": total_files, "path": source_path_str }),
            );

            let import_result: Result<(), String> = (|| {
                #[cfg(target_os = "android")]
                if is_android_content_uri(source_path_str) {
                    let resolved_name = resolve_android_content_uri_name(source_path_str)?;
                    let source_bytes = read_android_content_uri(source_path_str)?;
                    let source_name_path = Path::new(&resolved_name);
                    let file_date = exif_processing::get_creation_date_from_bytes(
                        &resolved_name,
                        &source_bytes,
                    );

                    let mut final_dest_folder = PathBuf::from(&destination_folder);
                    if settings.organize_by_date {
                        let date_format_str = settings
                            .date_folder_format
                            .replace("YYYY", "%Y")
                            .replace("MM", "%m")
                            .replace("DD", "%d");
                        let subfolder = file_date.format(&date_format_str).to_string();
                        final_dest_folder.push(subfolder);
                    }

                    fs::create_dir_all(&final_dest_folder)
                        .map_err(|e| format!("Failed to create destination folder: {}", e))?;

                    let new_stem = generate_filename_from_template(
                        &settings.filename_template,
                        source_name_path,
                        i + 1,
                        total_files,
                        &file_date,
                    );
                    let extension = source_name_path
                        .extension()
                        .and_then(|s| s.to_str())
                        .unwrap_or("");
                    let new_filename = format!("{}.{}", new_stem, extension);
                    let dest_file_path = final_dest_folder.join(new_filename);

                    if dest_file_path.exists() {
                        if settings.skip_duplicates {
                            log::info!(
                                "Skipping duplicate import target: {}",
                                dest_file_path.display()
                            );
                            return Ok(());
                        }
                        return Err(format!(
                            "File already exists at destination: {}",
                            dest_file_path.display()
                        ));
                    }

                    fs::write(&dest_file_path, source_bytes).map_err(|e| e.to_string())?;
                    if let Some(s) = dest_file_path.to_str() {
                        imported_paths.push(s.to_string());
                    }

                    if settings.delete_after_import {
                        log::info!(
                            "Skipping delete_after_import for Android content URI source: {}",
                            source_path_str
                        );
                    }

                    return Ok(());
                }

                let (source_path, source_sidecar) = parse_virtual_path(source_path_str);
                if !source_path.exists() {
                    return Err(format!("Source file not found: {}", source_path_str));
                }

                let file_date = exif_processing::get_creation_date_from_path(&source_path);

                let mut final_dest_folder = PathBuf::from(&destination_folder);
                if settings.organize_by_date {
                    let date_format_str = settings
                        .date_folder_format
                        .replace("YYYY", "%Y")
                        .replace("MM", "%m")
                        .replace("DD", "%d");
                    let subfolder = file_date.format(&date_format_str).to_string();
                    final_dest_folder.push(subfolder);
                }

                fs::create_dir_all(&final_dest_folder)
                    .map_err(|e| format!("Failed to create destination folder: {}", e))?;

                let new_stem = generate_filename_from_template(
                    &settings.filename_template,
                    &source_path,
                    i + 1,
                    total_files,
                    &file_date,
                );
                let src_ext = source_path
                    .extension()
                    .and_then(|s| s.to_str())
                    .unwrap_or("")
                    .to_lowercase();
                // LR "Copy as DNG": if source is already DNG, keep .dng; otherwise copy original
                // and report deferred conversion (full RAW→DNG encoder not bundled).
                let (extension, dng_note) = if settings.copy_as_dng {
                    if src_ext == "dng" {
                        dng_passthrough += 1;
                        ("dng".to_string(), "passthrough")
                    } else {
                        dng_deferred += 1;
                        (src_ext.clone(), "deferred")
                    }
                } else {
                    (src_ext.clone(), "")
                };
                let new_filename = if extension.is_empty() {
                    new_stem.clone()
                } else {
                    format!("{}.{}", new_stem, extension)
                };
                let dest_file_path = final_dest_folder.join(new_filename);

                if dest_file_path.exists() {
                    if settings.skip_duplicates {
                        log::info!(
                            "Skipping duplicate import target: {}",
                            dest_file_path.display()
                        );
                        return Ok(());
                    }
                    return Err(format!(
                        "File already exists at destination: {}",
                        dest_file_path.display()
                    ));
                }

                fs::copy(&source_path, &dest_file_path).map_err(|e| e.to_string())?;
                if settings.copy_as_dng && dng_note == "deferred" {
                    log::info!(
                        "Copy as DNG deferred for {} (imported as .{})",
                        source_path.display(),
                        extension
                    );
                }
                if let Some(s) = dest_file_path.to_str() {
                    imported_paths.push(s.to_string());
                }
                if source_sidecar.exists()
                    && let Some(dest_str) = dest_file_path.to_str()
                {
                    let (_, dest_sidecar) = parse_virtual_path(dest_str);
                    fs::copy(&source_sidecar, &dest_sidecar).map_err(|e| e.to_string())?;
                }

                // Copy Adobe/Lightroom .xmp sidecar next to the image when present
                if let Some(src_xmp) = resolve_xmp_path(&source_path) {
                    let dest_xmp = mirror_xmp_dest_path(&dest_file_path, &src_xmp, &source_path);
                    if let Err(e) = fs::copy(&src_xmp, &dest_xmp) {
                        log::warn!(
                            "Failed to copy XMP sidecar {} → {}: {}",
                            src_xmp.display(),
                            dest_xmp.display(),
                            e
                        );
                    }
                }

                let mut source_rrexif_name = source_path.file_name().unwrap().to_os_string();
                source_rrexif_name.push(".rrexif");
                let source_rrexif = source_path.with_file_name(source_rrexif_name);

                if source_rrexif.exists() {
                    let mut dest_rrexif_name = dest_file_path.file_name().unwrap().to_os_string();
                    dest_rrexif_name.push(".rrexif");
                    let dest_rrexif = dest_file_path.with_file_name(dest_rrexif_name);
                    let _ = fs::copy(&source_rrexif, &dest_rrexif);
                }

                if settings.delete_after_import {
                    #[cfg(any(target_os = "windows", target_os = "macos", target_os = "linux"))]
                    {
                        if let Err(trash_error) = trash::delete(&source_path) {
                            log::warn!(
                                "Failed to trash source file {}: {}. Deleting permanently.",
                                source_path.display(),
                                trash_error
                            );
                            fs::remove_file(&source_path).map_err(|e| e.to_string())?;
                        }
                        if source_sidecar.exists()
                            && let Err(trash_error) = trash::delete(&source_sidecar)
                        {
                            log::warn!(
                                "Failed to trash source sidecar {}: {}. Deleting permanently.",
                                source_sidecar.display(),
                                trash_error
                            );
                            fs::remove_file(&source_sidecar).map_err(|e| e.to_string())?;
                        }
                    }

                    #[cfg(not(any(
                        target_os = "windows",
                        target_os = "macos",
                        target_os = "linux"
                    )))]
                    {
                        fs::remove_file(&source_path).map_err(|e| e.to_string())?;
                        if source_sidecar.exists() {
                            fs::remove_file(&source_sidecar).map_err(|e| e.to_string())?;
                        }
                        if source_rrexif.exists() {
                            let _ = fs::remove_file(&source_rrexif);
                        }
                    }
                }

                Ok(())
            })();

            if let Err(e) = import_result {
                eprintln!("Failed to import {}: {}", source_path_str, e);
                let _ = app_handle.emit("import-error", e);
                return;
            }
        }

        let _ = app_handle.emit(
            "import-progress",
            serde_json::json!({ "current": total_files, "total": total_files, "path": "" }),
        );
        let _ = app_handle.emit(
            "import-complete",
            serde_json::json!({
                "destinationFolder": destination_folder,
                "developPresetId": settings.develop_preset_id,
                "importedCount": imported_paths.len(),
                "importedPaths": imported_paths,
                "buildPreviews": settings.build_previews,
                "keywords": settings.keywords,
                "creator": settings.creator,
                "copyright": settings.copyright,
                "caption": settings.caption,
                "copyAsDng": settings.copy_as_dng,
                "dngPassthrough": dng_passthrough,
                "dngDeferred": dng_deferred
            }),
        );
    });

    Ok(())
}

pub fn generate_filename_from_template(
    template: &str,
    original_path: &std::path::Path,
    sequence: usize,
    total: usize,
    file_date: &DateTime<Utc>,
) -> String {
    let stem = original_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("image");
    let sequence_str = format!(
        "{:0width$}",
        sequence,
        width = total.to_string().len().max(1)
    );
    let local_date = file_date.with_timezone(&chrono::Local);

    let mut result = template.to_string();
    result = result.replace("{original_filename}", stem);
    result = result.replace("{sequence}", &sequence_str);
    result = result.replace("{YYYY}", &local_date.format("%Y").to_string());
    result = result.replace("{MM}", &local_date.format("%m").to_string());
    result = result.replace("{DD}", &local_date.format("%d").to_string());
    result = result.replace("{hh}", &local_date.format("%H").to_string());
    result = result.replace("{mm}", &local_date.format("%M").to_string());
    result = result.replace("{ss}", &local_date.format("%S").to_string());
    result = result.replace("{YYYYMMDD}", &local_date.format("%Y%m%d").to_string());
    let folder = original_path
        .parent()
        .and_then(|p| p.file_name())
        .and_then(|s| s.to_str())
        .unwrap_or("export");
    result = result.replace("{folder}", folder);

    result
}

#[tauri::command]
pub fn rename_files(
    paths: Vec<String>,
    name_template: String,
    app_handle: AppHandle,
) -> Result<Vec<String>, String> {
    if paths.is_empty() {
        return Ok(Vec::new());
    }

    let mut operations: HashMap<PathBuf, PathBuf> = HashMap::new();
    let mut final_new_paths = Vec::with_capacity(paths.len());
    let mut renames = HashMap::new();

    for (i, path_str) in paths.iter().enumerate() {
        let (original_path, _) = parse_virtual_path(path_str);
        if !original_path.exists() {
            return Err(format!("File not found: {}", path_str));
        }

        let parent = original_path
            .parent()
            .ok_or("Could not get parent directory")?;
        let extension = original_path
            .extension()
            .and_then(|s| s.to_str())
            .unwrap_or("");

        let file_date = exif_processing::get_creation_date_from_path(&original_path);

        let new_stem = generate_filename_from_template(
            &name_template,
            &original_path,
            i + 1,
            paths.len(),
            &file_date,
        );
        let new_filename = format!("{}.{}", new_stem, extension);
        let new_path = parent.join(new_filename);

        if new_path.exists() && new_path != original_path {
            return Err(format!(
                "A file with the name {} already exists.",
                new_path.display()
            ));
        }

        operations.insert(original_path, new_path);
    }

    let mut sidecar_operations: HashMap<PathBuf, PathBuf> = HashMap::new();
    for (original_path, new_path) in &operations {
        let parent = original_path
            .parent()
            .ok_or("Could not get parent directory")?;
        let original_filename_str = original_path.file_name().unwrap().to_string_lossy();
        let new_filename_str = new_path.file_name().unwrap().to_string_lossy();

        if let Ok(entries) = fs::read_dir(parent) {
            for entry in entries.filter_map(Result::ok) {
                let entry_path = entry.path();
                let entry_os_filename = entry.file_name();
                let entry_filename = entry_os_filename.to_string_lossy();

                if entry_filename.starts_with(&format!("{}.", original_filename_str))
                    && entry_filename.ends_with(".rrdata")
                {
                    let new_sidecar_filename =
                        entry_filename.replacen(&*original_filename_str, &new_filename_str, 1);
                    let new_sidecar_path = parent.join(new_sidecar_filename);
                    sidecar_operations.insert(entry_path, new_sidecar_path);
                } else if entry_filename == format!("{}.rrdata", original_filename_str) {
                    let mut new_sidecar_name = new_path.file_name().unwrap().to_os_string();
                    new_sidecar_name.push(".rrdata");
                    let new_sidecar_path = new_path.with_file_name(new_sidecar_name);

                    sidecar_operations.insert(entry_path, new_sidecar_path);
                }
            }
        }

        let mut old_rrexif_name = original_path.file_name().unwrap().to_os_string();
        old_rrexif_name.push(".rrexif");
        let old_rrexif = original_path.with_file_name(old_rrexif_name);

        if old_rrexif.exists() {
            let mut new_rrexif_name = new_path.file_name().unwrap().to_os_string();
            new_rrexif_name.push(".rrexif");
            let new_rrexif = new_path.with_file_name(new_rrexif_name);
            sidecar_operations.insert(old_rrexif, new_rrexif);
        }
    }
    operations.extend(sidecar_operations);

    for (old_path, new_path) in operations {
        fs::rename(&old_path, &new_path).map_err(|e| {
            format!(
                "Failed to rename {} to {}: {}",
                old_path.display(),
                new_path.display(),
                e
            )
        })?;

        let old_str = old_path.to_string_lossy().into_owned();
        let new_str = new_path.to_string_lossy().into_owned();

        renames.insert(old_str, new_str.clone());

        if is_supported_image_file(&new_path) {
            final_new_paths.push(new_str);
        }
    }

    sync_album_path_changes(&app_handle, Some(&renames), None, None);

    Ok(final_new_paths)
}

#[tauri::command]
pub fn create_virtual_copy(
    source_virtual_path: String,
    target_album_id: Option<String>,
    app_handle: AppHandle,
) -> Result<String, String> {
    let (source_path, source_sidecar_path) = parse_virtual_path(&source_virtual_path);

    let new_copy_id = Uuid::new_v4().to_string()[..6].to_string();
    let new_virtual_path = format!("{}?vc={}", source_path.to_string_lossy(), new_copy_id);
    let (_, new_sidecar_path) = parse_virtual_path(&new_virtual_path);

    if source_sidecar_path.exists() {
        fs::copy(&source_sidecar_path, &new_sidecar_path)
            .map_err(|e| format!("Failed to copy sidecar file: {}", e))?;
    } else {
        let default_metadata = ImageMetadata::default();
        let json_string =
            serde_json::to_string_pretty(&default_metadata).map_err(|e| e.to_string())?;
        fs::write(new_sidecar_path, json_string).map_err(|e| e.to_string())?;
    }

    if let Some(album_id) = target_album_id {
        let _ = add_to_album(album_id, vec![new_virtual_path.clone()], app_handle);
    }

    Ok(new_virtual_path)
}

pub fn extract_xmp_rating(content: &str) -> Option<u8> {
    if let Some(idx) = content.find("xmp:Rating=\"") {
        let start = idx + 12;
        let end = content[start..].find('"').map(|i| start + i)?;
        return content[start..end].parse().ok();
    }
    if let Some(idx) = content.find("<xmp:Rating>") {
        let start = idx + 12;
        let end = content[start..].find('<').map(|i| start + i)?;
        return content[start..end].parse().ok();
    }
    None
}

pub fn extract_xmp_label(content: &str) -> Option<String> {
    if let Some(idx) = content.find("xmp:Label=\"") {
        let start = idx + 11;
        let end = content[start..].find('"').map(|i| start + i)?;
        return Some(content[start..end].to_string());
    }
    if let Some(idx) = content.find("<xmp:Label>") {
        let start = idx + 11;
        let end = content[start..].find('<').map(|i| start + i)?;
        return Some(content[start..end].to_string());
    }
    None
}

/// Pull bag items from an XMP Bag/Seq block between open/close tags.
fn extract_rdf_li_values(content: &str, open_tag: &str, close_tag: &str) -> Vec<String> {
    let mut out = Vec::new();
    if let Some(start_idx) = content.find(open_tag)
        && let Some(end_idx) = content[start_idx..].find(close_tag)
    {
        let block = &content[start_idx..start_idx + end_idx];
        let mut current_idx = 0;
        while let Some(li_start) = block[current_idx..].find("<rdf:li>") {
            let val_start = current_idx + li_start + 8;
            if let Some(li_end) = block[val_start..].find("</rdf:li>") {
                let raw = block[val_start..val_start + li_end].trim();
                // Unescape common XML entities
                let val = raw
                    .replace("&amp;", "&")
                    .replace("&lt;", "<")
                    .replace("&gt;", ">")
                    .replace("&quot;", "\"");
                if !val.is_empty() {
                    out.push(val);
                }
                current_idx = val_start + li_end + 9;
            } else {
                break;
            }
        }
    }
    out
}

/// Import keywords from XMP: `dc:subject` leaves + `lr:hierarchicalSubject` paths.
/// Hierarchical paths use `|` in Lightroom; we store as `user:parent/child` (+ parent segments).
pub fn extract_xmp_tags(content: &str) -> Vec<String> {
    let mut tags: Vec<String> = Vec::new();
    let push_unique = |tags: &mut Vec<String>, tag: String| {
        if !tag.is_empty() && !tags.iter().any(|t| t == &tag) {
            tags.push(tag);
        }
    };

    // Flat subjects
    for raw in extract_rdf_li_values(content, "<dc:subject>", "</dc:subject>") {
        let bare = raw.trim();
        if bare.is_empty() {
            continue;
        }
        // Preserve flag:/color: system tags as-is
        if bare.starts_with("flag:") || bare.starts_with("color:") || bare.starts_with("stack:") {
            push_unique(&mut tags, bare.to_string());
            continue;
        }
        // Already namespaced
        if bare.starts_with("user:") {
            push_unique(&mut tags, bare.to_lowercase());
            continue;
        }
        // Hierarchical path written into subject with / or |
        if bare.contains('|') || bare.contains('/') {
            let path = bare.replace('|', "/").to_lowercase();
            let parts: Vec<&str> = path.split('/').filter(|p| !p.is_empty()).collect();
            let mut acc = String::new();
            for part in parts {
                acc = if acc.is_empty() {
                    part.to_string()
                } else {
                    format!("{}/{}", acc, part)
                };
                push_unique(&mut tags, format!("user:{}", acc));
            }
            continue;
        }
        push_unique(&mut tags, format!("user:{}", bare.to_lowercase()));
    }

    // Lightroom hierarchicalSubject (paths with |)
    for raw in extract_rdf_li_values(
        content,
        "<lr:hierarchicalSubject>",
        "</lr:hierarchicalSubject>",
    ) {
        let path = raw.replace('|', "/").trim().to_lowercase();
        if path.is_empty() {
            continue;
        }
        let parts: Vec<&str> = path.split('/').filter(|p| !p.is_empty()).collect();
        let mut acc = String::new();
        for part in parts {
            acc = if acc.is_empty() {
                part.to_string()
            } else {
                format!("{}/{}", acc, part)
            };
            push_unique(&mut tags, format!("user:{}", acc));
        }
    }

    tags
}


/// Choose destination XMP path that preserves source naming style (photo.xmp vs photo.ARW.xmp).
fn mirror_xmp_dest_path(dest_image: &Path, src_xmp: &Path, source_image: &Path) -> PathBuf {
    let src_name = src_xmp.file_name().and_then(|n| n.to_str()).unwrap_or("");
    let stem = source_image
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("");
    if src_name.eq_ignore_ascii_case(&format!("{}.xmp", stem))
        || src_name.eq_ignore_ascii_case(&format!("{}.XMP", stem))
    {
        dest_image.with_extension("xmp")
    } else {
        let mut name = dest_image.file_name().unwrap().to_os_string();
        name.push(".xmp");
        dest_image.with_file_name(name)
    }
}

pub fn resolve_xmp_path(image_path: &Path) -> Option<PathBuf> {
    // Style A (common): photo.xmp / photo.XMP next to photo.ARW
    let xmp_path = image_path.with_extension("xmp");
    let xmp_path_upper = image_path.with_extension("XMP");
    if xmp_path.exists() {
        return Some(xmp_path);
    }
    if xmp_path_upper.exists() {
        return Some(xmp_path_upper);
    }
    // Style B (also used by Adobe tooling): photo.ARW.xmp
    if let Some(name) = image_path.file_name() {
        let mut dotted = name.to_os_string();
        dotted.push(".xmp");
        let candidate = image_path.with_file_name(&dotted);
        if candidate.exists() {
            return Some(candidate);
        }
        let mut dotted_upper = name.to_os_string();
        dotted_upper.push(".XMP");
        let candidate_upper = image_path.with_file_name(&dotted_upper);
        if candidate_upper.exists() {
            return Some(candidate_upper);
        }
    }
    None
}

pub fn sync_metadata_from_xmp(source_path: &Path, metadata: &mut ImageMetadata) -> bool {
    let actual_xmp = resolve_xmp_path(source_path);

    let mut changed = false;

    if let Some(xmp_file) = actual_xmp
        && let Ok(content) = fs::read_to_string(&xmp_file)
    {
        if metadata.rating == 0
            && let Some(rating) = extract_xmp_rating(&content)
            && rating != 0
        {
            metadata.rating = rating;
            if let Some(obj) = metadata.adjustments.as_object_mut() {
                obj.insert("rating".to_string(), serde_json::json!(rating));
            } else {
                metadata.adjustments = serde_json::json!({"rating": rating});
            }
            changed = true;
        }

        let xmp_label = extract_xmp_label(&content);
        let xmp_tags = extract_xmp_tags(&content);

        let mut current_tags = metadata.tags.clone().unwrap_or_default();
        let original_len = current_tags.len();
        let had_no_tags = metadata.tags.is_none();

        for tag in xmp_tags {
            if !current_tags.contains(&tag) {
                current_tags.push(tag);
            }
        }

        if let Some(label) = xmp_label {
            let label_tag = format!("{}{}", COLOR_TAG_PREFIX, label.to_lowercase());
            if !current_tags.contains(&label_tag) {
                current_tags.retain(|t| !t.starts_with(COLOR_TAG_PREFIX));
                current_tags.push(label_tag);
            }
        }

        if current_tags.len() != original_len || (had_no_tags && !current_tags.is_empty()) {
            metadata.tags = Some(current_tags);
            changed = true;
        }

        // Import develop settings from sidecar XMP when we don't already have RR adjustments.
        // Lightroom writes crs:* develop params into the photo's .xmp sidecar.
        let adjustments_empty = metadata.adjustments.is_null()
            || metadata
                .adjustments
                .as_object()
                .map(|o| {
                    o.keys()
                        .all(|k| k == "rating" || k == "sectionVisibility")
                })
                .unwrap_or(true);
        let looks_like_develop = content.contains("crs:")
            && (content.contains("HasSettings")
                || content.contains("Exposure2012")
                || content.contains("ToneCurvePV2012")
                || content.contains("ConvertToGrayscale")
                || content.contains("Highlights2012"));
        if adjustments_empty && looks_like_develop {
            match preset_converter::convert_xmp_to_preset(&content) {
                Ok(preset) => {
                    if let Some(dev) = preset.adjustments.as_object() {
                        if !dev.is_empty() {
                            // Preserve rating if we already set it above
                            let mut merged = dev.clone();
                            if metadata.rating > 0 {
                                merged.insert(
                                    "rating".to_string(),
                                    serde_json::json!(metadata.rating),
                                );
                            }
                            metadata.adjustments = serde_json::Value::Object(merged);
                            changed = true;
                            log::info!(
                                "Imported develop settings from sidecar XMP for {}",
                                source_path.display()
                            );
                        }
                    }
                }
                Err(e) => {
                    log::warn!(
                        "Failed to parse develop XMP for {}: {}",
                        source_path.display(),
                        e
                    );
                }
            }
        }

        // Import DC description / creator / rights into exif map for Metadata panel
        let mut exif_map = metadata.exif.clone().unwrap_or_default();
        let mut exif_changed = false;
        if let Some(desc) = extract_dc_alt_text(&content, "description") {
            if exif_map.get("ImageDescription").map(|s| s.as_str()) != Some(desc.as_str()) {
                exif_map.insert("ImageDescription".to_string(), desc);
                exif_changed = true;
            }
        }
        if let Some(title) = extract_dc_alt_text(&content, "title") {
            if exif_map.get("XPTitle").map(|s| s.as_str()) != Some(title.as_str()) {
                exif_map.insert("XPTitle".to_string(), title.clone());
                exif_map.insert("Title".to_string(), title);
                exif_changed = true;
            }
        }
        // photoshop:DateCreated → DateTimeOriginal (when not already set)
        if !exif_map.contains_key("DateTimeOriginal") {
            if let Some(dc) = extract_simple_xmp_field(&content, "photoshop", "DateCreated") {

                // Store as EXIF-ish string
                let as_exif = dc.replace('T', " ").replace('-', ":");
                // Only replace first two dashes-turned-colons in date part carefully:
                let as_exif = if dc.len() >= 10 {
                    let d = &dc[..10].replace('-', ":");
                    let rest = if dc.len() > 10 { &dc[10..] } else { "" };
                    let rest = rest.trim_start_matches('T').trim_start_matches(' ');
                    if rest.is_empty() {
                        format!("{} 00:00:00", d)
                    } else {
                        format!("{} {}", d, rest)
                    }
                } else {
                    as_exif
                };
                exif_map.insert("DateTimeOriginal".to_string(), as_exif);
                exif_changed = true;
            }
        }
        if let Some(creator) = extract_dc_alt_text(&content, "creator") {
            if exif_map.get("Artist").map(|s| s.as_str()) != Some(creator.as_str()) {
                exif_map.insert("Artist".to_string(), creator.clone());
                exif_map.insert("Creator".to_string(), creator);
                exif_changed = true;
            }
        }
        if let Some(rights) = extract_dc_alt_text(&content, "rights") {
            if exif_map.get("Copyright").map(|s| s.as_str()) != Some(rights.as_str()) {
                exif_map.insert("Copyright".to_string(), rights);
                exif_changed = true;
            }
        }
        // IPTC location / headline from photoshop + Iptc4xmpCore (LR sidecars)
        for (ns, tag, keys) in [
            ("photoshop", "City", &["City"][..]),
            ("photoshop", "Country", &["Country"][..]),
            ("photoshop", "State", &["State", "Province"][..]),
            ("photoshop", "Headline", &["Headline"][..]),
            ("photoshop", "Credit", &["Credit"][..]),
            ("photoshop", "CaptionWriter", &["CaptionWriter", "Writer"][..]),
            ("photoshop", "Category", &["Category"][..]),
            ("photoshop", "Urgency", &["Urgency"][..]),
            ("photoshop", "Source", &["Source"][..]),
            ("photoshop", "Instructions", &["Instructions"][..]),
            ("photoshop", "AuthorsPosition", &["AuthorsPosition"][..]),
            ("photoshop", "TransmissionReference", &["JobIdentifier", "JobID"][..]),
            ("photoshop", "JobIdentifier", &["JobIdentifier"][..]),
            ("Iptc4xmpCore", "CountryCode", &["CountryCode"][..]),
            ("Iptc4xmpCore", "IntellectualGenre", &["IntellectualGenre"][..]),
            ("Iptc4xmpCore", "Location", &["Location", "SubLocation"][..]),
        ] {
            if let Some(val) = extract_simple_xmp_field(&content, ns, tag) {
                let missing = keys.iter().all(|k| !exif_map.contains_key(*k));
                if missing {
                    for k in keys {
                        exif_map.insert((*k).to_string(), val.clone());
                    }
                    exif_changed = true;
                }
            }
        }
        // Iptc4xmpExt:Event (alt-lang)
        if let Some(ev) = extract_namespaced_alt_text(&content, "Iptc4xmpExt", "Event")
            .or_else(|| extract_simple_xmp_field(&content, "Iptc4xmpExt", "Event"))
        {
            if exif_map.get("Event").map(|s| s.as_str()) != Some(ev.as_str()) {
                exif_map.insert("Event".to_string(), ev);
                exif_changed = true;
            }
        }
        if let Some(dst) = extract_simple_xmp_field(&content, "Iptc4xmpExt", "DigitalSourceType") {
            if exif_map.get("DigitalSourceType").map(|s| s.as_str()) != Some(dst.as_str()) {
                exif_map.insert("DigitalSourceType".to_string(), dst);
                exif_changed = true;
            }
        }
        if let Some(people) = extract_person_in_image(&content) {
            if exif_map.get("PersonInImage").map(|s| s.as_str()) != Some(people.as_str()) {
                exif_map.insert("PersonInImage".to_string(), people);
                exif_changed = true;
            }
        }
        if let Some(scene) = extract_string_bag(&content, "Iptc4xmpCore", "Scene") {
            if exif_map.get("Scene").map(|s| s.as_str()) != Some(scene.as_str()) {
                exif_map.insert("Scene".to_string(), scene);
                exif_changed = true;
            }
        }
        if let Some(supp) = extract_string_bag(&content, "photoshop", "SupplementalCategories") {
            if exif_map
                .get("SupplementalCategories")
                .map(|s| s.as_str())
                != Some(supp.as_str())
            {
                exif_map.insert("SupplementalCategories".to_string(), supp);
                exif_changed = true;
            }
        }
        if let Some(codes) = extract_string_bag(&content, "Iptc4xmpCore", "SubjectCode") {
            if exif_map.get("SubjectCode").map(|s| s.as_str()) != Some(codes.as_str()) {
                exif_map.insert("SubjectCode".to_string(), codes);
                exif_changed = true;
            }
        }
        // xmpRights:UsageTerms (alt-lang)
        if let Some(ut) = extract_namespaced_alt_text(&content, "xmpRights", "UsageTerms")
            .or_else(|| extract_simple_xmp_field(&content, "xmpRights", "UsageTerms"))
        {
            if exif_map.get("UsageTerms").map(|s| s.as_str()) != Some(ut.as_str()) {
                exif_map.insert("UsageTerms".to_string(), ut);
                exif_changed = true;
            }
        }
        if let Some(ws) = extract_simple_xmp_field(&content, "xmpRights", "WebStatement") {
            if exif_map.get("WebStatement").map(|s| s.as_str()) != Some(ws.as_str()) {
                exif_map.insert("WebStatement".to_string(), ws);
                exif_changed = true;
            }
        }
        if let Some(url) = extract_simple_xmp_field(&content, "Iptc4xmpCore", "CreatorWorkURL")
            .or_else(|| extract_simple_xmp_field(&content, "Iptc4xmpCore", "CiUrlWork"))
        {
            if exif_map.get("CreatorWorkURL").map(|s| s.as_str()) != Some(url.as_str()) {
                exif_map.insert("CreatorWorkURL".to_string(), url.clone());
                exif_map.insert("CiUrlWork".to_string(), url);
                exif_changed = true;
            }
        }
        if let Some(em) = extract_simple_xmp_field(&content, "Iptc4xmpCore", "CiEmailWork") {
            if exif_map.get("CiEmailWork").map(|s| s.as_str()) != Some(em.as_str()) {
                exif_map.insert("CiEmailWork".to_string(), em.clone());
                exif_map.insert("Email".to_string(), em);
                exif_changed = true;
            }
        }
        if let Some(ph) = extract_simple_xmp_field(&content, "Iptc4xmpCore", "CiTelWork") {
            if exif_map.get("CiTelWork").map(|s| s.as_str()) != Some(ph.as_str()) {
                exif_map.insert("CiTelWork".to_string(), ph.clone());
                exif_map.insert("Phone".to_string(), ph);
                exif_changed = true;
            }
        }
        for (tag, keys) in [
            ("CiAdrExtadr", &["CiAdrExtadr", "Creator Address"][..]),
            ("CiAdrCity", &["CiAdrCity"][..]),
            ("CiAdrRegion", &["CiAdrRegion"][..]),
            ("CiAdrPcode", &["CiAdrPcode"][..]),
            ("CiAdrCtry", &["CiAdrCtry"][..]),
        ] {
            if let Some(val) = extract_simple_xmp_field(&content, "Iptc4xmpCore", tag) {
                let missing = keys.iter().all(|k| !exif_map.contains_key(*k));
                if missing {
                    for k in keys {
                        exif_map.insert((*k).to_string(), val.clone());
                    }
                    exif_changed = true;
                }
            }
        }
        // Copyright status: prefer photoshop:CopyrightStatus, else map xmpRights:Marked
        if let Some(cs) = extract_simple_xmp_field(&content, "photoshop", "CopyrightStatus") {
            if exif_map.get("CopyrightStatus").map(|s| s.as_str()) != Some(cs.as_str()) {
                exif_map.insert("CopyrightStatus".to_string(), cs);
                exif_changed = true;
            }
        } else if let Some(marked) = extract_simple_xmp_field(&content, "xmpRights", "Marked") {
            let label = if marked.eq_ignore_ascii_case("True") {
                "Copyrighted"
            } else if marked.eq_ignore_ascii_case("False") {
                "Public Domain"
            } else {
                ""
            };
            if !label.is_empty()
                && exif_map.get("CopyrightStatus").map(|s| s.as_str()) != Some(label)
            {
                exif_map.insert("CopyrightStatus".to_string(), label.to_string());
                exif_changed = true;
            }
        }

        if exif_changed {
            metadata.exif = Some(exif_map);
            changed = true;
        }
    }
    changed
}


/// Merge RapidRAW develop adjustments into an existing photo XMP document (best-effort).
/// Updates/inserts crs:* attributes and nested crs elements; preserves other XMP metadata.
fn merge_develop_into_xmp(content: &str, adjustments: &Value) -> String {
    let develop_empty = adjustments.is_null()
        || adjustments.as_object().map(|o| {
            o.keys()
                .filter(|k| *k != "rating" && *k != "sectionVisibility")
                .count()
                == 0
        }).unwrap_or(true);
    if develop_empty {
        return content.to_string();
    }

    let develop_xmp = preset_converter::convert_adjustments_to_xmp("RapidRAW", adjustments);

    // Collect crs attribute lines: crs:Foo="bar"
    let attr_re = Regex::new(r#"(?m)^\s*(crs:[A-Za-z0-9]+="[^"]*")\s*$"#).unwrap();
    let mut attrs: Vec<String> = Vec::new();
    for cap in attr_re.captures_iter(&develop_xmp) {
        let a = cap[1].to_string();
        // skip version noise if desired - keep all
        attrs.push(a);
    }

    // Collect nested crs element blocks (Name, ToneCurve*, etc.)
    let elem_re = Regex::new(r"(?s)(<crs:[A-Za-z0-9]+[\s>].*?</crs:[A-Za-z0-9]+>)").unwrap();
    let mut elems: Vec<String> = Vec::new();
    for cap in elem_re.captures_iter(&develop_xmp) {
        let e = cap[1].trim().to_string();
        // skip Name if we don't want RapidRAW name on photo sidecars
        if e.starts_with("<crs:Name>") {
            continue;
        }
        elems.push(e);
    }

    let mut out = content.to_string();

    // Ensure crs namespace on rdf:Description
    if !out.contains("xmlns:crs=") {
        out = out.replacen(
            "<rdf:Description",
            r#"<rdf:Description xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/""#,
            1,
        );
    }

    // Remove existing crs attributes on Description (simple global)
    let strip_attr = Regex::new(r#"\s+crs:[A-Za-z0-9]+="[^"]*""#).unwrap();
    out = strip_attr.replace_all(&out, "").to_string();

    // Remove existing nested crs element blocks
    let strip_elem = Regex::new(r"(?s)\s*<crs:[A-Za-z0-9]+(?:\s[^>]*)?>.*?</crs:[A-Za-z0-9]+>").unwrap();
    out = strip_elem.replace_all(&out, "").to_string();
    // self-closing crs if any
    let strip_self = Regex::new(r#"\s*<crs:[A-Za-z0-9]+[^>]*/>"#).unwrap();
    out = strip_self.replace_all(&out, "").to_string();

    // Inject attributes into first rdf:Description tag (before > or />)
    if let Some(desc_idx) = out.find("<rdf:Description") {
        if let Some(rel_end) = out[desc_idx..].find('>') {
            let abs_end = desc_idx + rel_end;
            let is_self_closing = abs_end > 0 && out.as_bytes()[abs_end - 1] == b'/';
            let insert_at = if is_self_closing { abs_end - 1 } else { abs_end };
            let mut attr_block = String::new();
            for a in &attrs {
                attr_block.push_str("\n   ");
                attr_block.push_str(a);
            }
            out.insert_str(insert_at, &attr_block);
        }
    }

    // Inject nested elements before </rdf:Description>
    if !elems.is_empty() {
        if let Some(last_index) = out.rfind("</rdf:Description>") {
            let mut block = String::new();
            for e in &elems {
                block.push_str("   ");
                block.push_str(e);
                block.push('\n');
            }
            let (start, end) = out.split_at(last_index);
            out = format!("{}{}{}", start, block, end);
        }
    }

    // Mark HasSettings
    if !out.contains("crs:HasSettings=") {
        if let Some(desc_idx) = out.find("<rdf:Description") {
            if let Some(rel_end) = out[desc_idx..].find('>') {
                let abs_end = desc_idx + rel_end;
                let is_self_closing = abs_end > 0 && out.as_bytes()[abs_end - 1] == b'/';
                let insert_at = if is_self_closing { abs_end - 1 } else { abs_end };
                out.insert_str(insert_at, r#" crs:HasSettings="True""#);
            }
        }
    }

    out
}


/// Escape text for XMP/XML text nodes.
fn xml_escape_text(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

/// Upsert namespaced alt-lang field: <ns:TAG><rdf:Alt><rdf:li xml:lang="x-default">…</rdf:li></rdf:Alt></ns:TAG>
/// Upsert Iptc4xmpExt:PersonInImage as rdf:Bag of names (comma/semicolon separated input).
/// Upsert a namespaced rdf:Bag of strings from comma/semicolon-separated input.
fn upsert_string_bag(content: &str, ns: &str, tag: &str, values: &str) -> String {
    let re = Regex::new(&format!(
        r#"(?s)\s*<{ns}:{tag}>\s*<rdf:Bag>.*?</rdf:Bag>\s*</{ns}:{tag}>"#,
        ns = ns,
        tag = tag
    ))
    .unwrap();
    let mut out = content.to_string();
    // ensure common IPTC core ns when used
    if ns == "Iptc4xmpCore" {
        out = ensure_xmlns(
            &out,
            "Iptc4xmpCore",
            "http://iptc.org/std/Iptc4xmpCore/1.0/xmlns/",
        );
    } else if ns == "Iptc4xmpExt" {
        out = ensure_xmlns(
            &out,
            "Iptc4xmpExt",
            "http://iptc.org/std/Iptc4xmpExt/2008-02-29/",
        );
    }
    let items: Vec<String> = values
        .split(|c| c == ',' || c == ';')
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .map(|s| xml_escape_text(s))
        .collect();
    if items.is_empty() {
        return re.replace_all(&out, "").to_string();
    }
    let mut bag = format!("<{ns}:{tag}>\n    <rdf:Bag>\n", ns = ns, tag = tag);
    for n in &items {
        bag.push_str(&format!("     <rdf:li>{}</rdf:li>\n", n));
    }
    bag.push_str(&format!("    </rdf:Bag>\n   </{ns}:{tag}>", ns = ns, tag = tag));
    if re.is_match(&out) {
        re.replace(&out, format!("\n   {}", bag)).to_string()
    } else if let Some(last_index) = out.rfind("</rdf:Description>") {
        let (start, end) = out.split_at(last_index);
        format!("{} {}\n  {}", start, bag, end)
    } else {
        out
    }
}

fn extract_string_bag(content: &str, ns: &str, tag: &str) -> Option<String> {
    let re = Regex::new(&format!(
        r#"(?s)<{ns}:{tag}>\s*<rdf:Bag>(.*?)</rdf:Bag>\s*</{ns}:{tag}>"#,
        ns = ns,
        tag = tag
    ))
    .ok()?;
    let bag = re.captures(content)?.get(1)?.as_str();
    let li = Regex::new(r#"<rdf:li[^>]*>([^<]*)</rdf:li>"#).ok()?;
    let mut names = Vec::new();
    for c in li.captures_iter(bag) {
        if let Some(m) = c.get(1) {
            let s = m
                .as_str()
                .replace("&amp;", "&")
                .replace("&lt;", "<")
                .replace("&gt;", ">")
                .replace("&quot;", "\"")
                .trim()
                .to_string();
            if !s.is_empty() {
                names.push(s);
            }
        }
    }
    if names.is_empty() {
        None
    } else {
        Some(names.join(", "))
    }
}

fn upsert_person_in_image_bag(content: &str, people: &str) -> String {
    let re = Regex::new(
        r#"(?s)\s*<Iptc4xmpExt:PersonInImage>\s*<rdf:Bag>.*?</rdf:Bag>\s*</Iptc4xmpExt:PersonInImage>"#,
    )
    .unwrap();
    let mut out = content.to_string();
    out = ensure_xmlns(
        &out,
        "Iptc4xmpExt",
        "http://iptc.org/std/Iptc4xmpExt/2008-02-29/",
    );
    let names: Vec<String> = people
        .split(|c| c == ',' || c == ';')
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .map(|s| xml_escape_text(s))
        .collect();
    if names.is_empty() {
        return re.replace_all(&out, "").to_string();
    }
    let mut bag = String::from("<Iptc4xmpExt:PersonInImage>\n    <rdf:Bag>\n");
    for n in &names {
        bag.push_str(&format!("     <rdf:li>{}</rdf:li>\n", n));
    }
    bag.push_str("    </rdf:Bag>\n   </Iptc4xmpExt:PersonInImage>");
    if re.is_match(&out) {
        re.replace(&out, format!("\n   {}", bag)).to_string()
    } else if let Some(last_index) = out.rfind("</rdf:Description>") {
        let (start, end) = out.split_at(last_index);
        format!("{} {}\n  {}", start, bag, end)
    } else {
        out
    }
}

fn extract_person_in_image(content: &str) -> Option<String> {
    let re = Regex::new(
        r#"(?s)<Iptc4xmpExt:PersonInImage>\s*<rdf:Bag>(.*?)</rdf:Bag>\s*</Iptc4xmpExt:PersonInImage>"#,
    )
    .ok()?;
    let bag = re.captures(content)?.get(1)?.as_str();
    let li = Regex::new(r#"<rdf:li[^>]*>([^<]*)</rdf:li>"#).ok()?;
    let mut names = Vec::new();
    for c in li.captures_iter(bag) {
        if let Some(m) = c.get(1) {
            let s = m
                .as_str()
                .replace("&amp;", "&")
                .replace("&lt;", "<")
                .replace("&gt;", ">")
                .replace("&quot;", "\"")
                .trim()
                .to_string();
            if !s.is_empty() {
                names.push(s);
            }
        }
    }
    if names.is_empty() {
        None
    } else {
        Some(names.join(", "))
    }
}

fn upsert_namespaced_alt_field(content: &str, ns: &str, tag: &str, value: Option<&str>) -> String {
    let re = Regex::new(&format!(
        r#"(?s)\s*<{ns}:{tag}>\s*<rdf:Alt>.*?</rdf:Alt>\s*</{ns}:{tag}>"#,
        ns = ns,
        tag = tag
    ))
    .unwrap();
    let mut out = content.to_string();
    match value {
        None | Some("") => {
            out = re.replace_all(&out, "").to_string();
        }
        Some(v) => {
            let safe = xml_escape_text(v.trim());
            let block = format!(
                "<{ns}:{tag}>\n    <rdf:Alt>\n     <rdf:li xml:lang=\"x-default\">{safe}</rdf:li>\n    </rdf:Alt>\n   </{ns}:{tag}>",
                ns = ns,
                tag = tag,
                safe = safe
            );
            if re.is_match(&out) {
                out = re.replace(&out, format!("\n   {}", block)).to_string();
            } else if let Some(last_index) = out.rfind("</rdf:Description>") {
                let (start, end) = out.split_at(last_index);
                out = format!("{} {}\n  {}", start, block, end);
            }
        }
    }
    out
}

/// Upsert a Dublin Core alt-lang field: <dc:TAG><rdf:Alt><rdf:li xml:lang="x-default">…</rdf:li></rdf:Alt></dc:TAG>
fn upsert_dc_alt_field(content: &str, tag: &str, value: Option<&str>) -> String {
    let re = Regex::new(&format!(
        r#"(?s)\s*<dc:{tag}>\s*<rdf:Alt>.*?</rdf:Alt>\s*</dc:{tag}>"#,
        tag = tag
    ))
    .unwrap();
    let mut out = content.to_string();
    match value {
        None | Some("") => {
            out = re.replace_all(&out, "").to_string();
        }
        Some(v) => {
            let safe = xml_escape_text(v.trim());
            let block = format!(
                "<dc:{tag}>\n    <rdf:Alt>\n     <rdf:li xml:lang=\"x-default\">{safe}</rdf:li>\n    </rdf:Alt>\n   </dc:{tag}>",
                tag = tag,
                safe = safe
            );
            if re.is_match(&out) {
                out = re.replace(&out, format!("\n   {}", block)).to_string();
            } else if let Some(last_index) = out.rfind("</rdf:Description>") {
                let (start, end) = out.split_at(last_index);
                out = format!("{} {}\n  {}", start, block, end);
            }
        }
    }
    out
}

/// Ensure xmlns:dc is declared on rdf:Description for LR-compatible DC packets.
fn ensure_dc_namespace(content: &str) -> String {
    if content.contains("xmlns:dc=") {
        return content.to_string();
    }
    if let Some(idx) = content.find("<rdf:Description") {
        // insert after opening tag name
        let rest = &content[idx..];
        if let Some(gt) = rest.find('>') {
            let insert_at = idx + gt;
            let (a, b) = content.split_at(insert_at);
            return format!(
                r#"{} xmlns:dc="http://purl.org/dc/elements/1.1/"{}"#,
                a, b
            );
        }
    }
    content.to_string()
}

fn extract_namespaced_alt_text(content: &str, ns: &str, tag: &str) -> Option<String> {
    let re = Regex::new(&format!(
        r#"(?s)<{ns}:{tag}>\s*<rdf:Alt>\s*<rdf:li[^>]*>([^<]*)</rdf:li>"#,
        ns = ns,
        tag = tag
    ))
    .ok()?;
    re.captures(content).and_then(|c| {
        c.get(1).map(|m| {
            m.as_str()
                .replace("&amp;", "&")
                .replace("&lt;", "<")
                .replace("&gt;", ">")
                .replace("&quot;", "\"")
                .trim()
                .to_string()
        })
    })
    .filter(|s| !s.is_empty())
}

fn extract_dc_alt_text(content: &str, tag: &str) -> Option<String> {
    let re = Regex::new(&format!(
        r#"(?s)<dc:{tag}>\s*<rdf:Alt>\s*<rdf:li[^>]*>([^<]*)</rdf:li>"#,
        tag = tag
    ))
    .ok()?;
    re.captures(content)
        .and_then(|c| c.get(1).map(|m| {
            m.as_str()
                .replace("&amp;", "&")
                .replace("&lt;", "<")
                .replace("&gt;", ">")
                .replace("&quot;", "\"")
                .trim()
                .to_string()
        }))
        .filter(|s| !s.is_empty())
}


fn ensure_xmlns(content: &str, prefix: &str, uri: &str) -> String {
    let needle = format!("xmlns:{}=", prefix);
    if content.contains(&needle) {
        return content.to_string();
    }
    if let Some(idx) = content.find("<rdf:Description") {
        let rest = &content[idx..];
        if let Some(gt) = rest.find('>') {
            let insert_at = idx + gt;
            let (a, b) = content.split_at(insert_at);
            return format!(r#"{} xmlns:{}="{}"{}"#, a, prefix, uri, b);
        }
    }
    content.to_string()
}

/// Read a simple XMP field as element or attribute: photoshop:City / <photoshop:City>…
fn extract_simple_xmp_field(content: &str, ns: &str, tag: &str) -> Option<String> {
    let re_elem = Regex::new(&format!(
        r#"<{ns}:{tag}\s*>([^<]*)</{ns}:{tag}>"#,
        ns = ns,
        tag = tag
    ))
    .ok()?;
    if let Some(c) = re_elem.captures(content) {
        if let Some(m) = c.get(1) {
            let s = m
                .as_str()
                .replace("&amp;", "&")
                .replace("&lt;", "<")
                .replace("&gt;", ">")
                .replace("&quot;", "\"")
                .trim()
                .to_string();
            if !s.is_empty() {
                return Some(s);
            }
        }
    }
    let re_attr = Regex::new(&format!(
        r#"{ns}:{tag}\s*=\s*"([^"]*)""#,
        ns = ns,
        tag = tag
    ))
    .ok()?;
    if let Some(c) = re_attr.captures(content) {
        if let Some(m) = c.get(1) {
            let s = m
                .as_str()
                .replace("&amp;", "&")
                .replace("&lt;", "<")
                .replace("&gt;", ">")
                .replace("&quot;", "\"")
                .trim()
                .to_string();
            if !s.is_empty() {
                return Some(s);
            }
        }
    }
    None
}

/// Upsert a simple element like <photoshop:City>…</photoshop:City> or attribute form.
fn upsert_simple_xmp_field(content: &str, ns: &str, tag: &str, value: Option<&str>) -> String {
    let re_attr = Regex::new(&format!(r#"{ns}:{tag}\s*=\s*"[^"]*""#, ns = ns, tag = tag)).unwrap();
    let re_elem = Regex::new(&format!(
        r#"<{ns}:{tag}\s*>[^<]*</{ns}:{tag}>"#,
        ns = ns,
        tag = tag
    ))
    .unwrap();
    let re_elem_ws = Regex::new(&format!(
        r#"\s*<{ns}:{tag}\s*>[^<]*</{ns}:{tag}>"#,
        ns = ns,
        tag = tag
    ))
    .unwrap();

    match value {
        None | Some("") => {
            let mut c = re_attr.replace_all(content, "").to_string();
            c = re_elem_ws.replace_all(&c, "").to_string();
            c
        }
        Some(v) => {
            let escaped = v
                .replace('&', "&amp;")
                .replace('<', "&lt;")
                .replace('>', "&gt;")
                .replace('"', "&quot;");
            if re_attr.is_match(content) {
                re_attr
                    .replace(content, format!(r#"{ns}:{tag}="{}""#, escaped, ns = ns, tag = tag))
                    .to_string()
            } else if re_elem.is_match(content) {
                re_elem
                    .replace(
                        content,
                        format!("<{ns}:{tag}>{}</{ns}:{tag}>", escaped, ns = ns, tag = tag),
                    )
                    .to_string()
            } else if let Some(last_index) = content.rfind("</rdf:Description>") {
                let (start, end) = content.split_at(last_index);
                format!(
                    "{} <{ns}:{tag}>{}</{ns}:{tag}>\n{}",
                    start, escaped, end, ns = ns, tag = tag
                )
            } else {
                content.to_string()
            }
        }
    }
}

pub fn sync_metadata_to_xmp(source_path: &Path, metadata: &ImageMetadata, create_if_missing: bool) {
    let xmp_path = source_path.with_extension("xmp");
    let xmp_path_upper = source_path.with_extension("XMP");

    let mut actual_xmp = if xmp_path.exists() {
        Some(xmp_path.clone())
    } else if xmp_path_upper.exists() {
        Some(xmp_path_upper.clone())
    } else {
        None
    };

    if actual_xmp.is_none() {
        if !create_if_missing {
            return;
        }
        let skeleton = r#"<?xml version="1.0" encoding="UTF-8"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="RapidRAW">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
    xmlns:xmp="http://ns.adobe.com/xap/1.0/"
    xmlns:dc="http://purl.org/dc/elements/1.1/"
    xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/">
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>"#;
        if let Err(e) = fs::write(&xmp_path, skeleton) {
            log::error!("Failed to create skeleton XMP: {}", e);
            return;
        }
        actual_xmp = Some(xmp_path);
    }

    if let Some(xmp_file) = actual_xmp
        && let Ok(mut content) = fs::read_to_string(&xmp_file)
    {
        let rating_str = metadata.rating.to_string();
        let re_rating_attr = Regex::new(r#"xmp:Rating\s*=\s*"[^"]*""#).unwrap();
        let re_rating_tag = Regex::new(r#"<xmp:Rating\s*>[^<]*</xmp:Rating>"#).unwrap();

        if re_rating_attr.is_match(&content) {
            content = re_rating_attr
                .replace(&content, format!("xmp:Rating=\"{}\"", rating_str))
                .to_string();
        } else if re_rating_tag.is_match(&content) {
            content = re_rating_tag
                .replace(&content, format!("<xmp:Rating>{}</xmp:Rating>", rating_str))
                .to_string();
        } else if let Some(last_index) = content.rfind("</rdf:Description>") {
            let (start, end) = content.split_at(last_index);
            content = format!("{} <xmp:Rating>{}</xmp:Rating>\n{}", start, rating_str, end);
        }

        let current_tags = metadata.tags.clone().unwrap_or_default();
        let mut label = None;
        let mut normal_tags = Vec::new();

        for t in current_tags {
            if let Some(color) = t.strip_prefix(COLOR_TAG_PREFIX) {
                let mut c = color.chars();
                let cap_color = match c.next() {
                    None => String::new(),
                    Some(f) => f.to_uppercase().collect::<String>() + c.as_str(),
                };
                label = Some(cap_color);
            } else {
                normal_tags.push(t);
            }
        }

        if let Some(lbl) = label {
            let re_label_attr = Regex::new(r#"xmp:Label\s*=\s*"[^"]*""#).unwrap();
            let re_label_tag = Regex::new(r#"<xmp:Label\s*>[^<]*</xmp:Label>"#).unwrap();

            if re_label_attr.is_match(&content) {
                content = re_label_attr
                    .replace(&content, format!("xmp:Label=\"{}\"", lbl))
                    .to_string();
            } else if re_label_tag.is_match(&content) {
                content = re_label_tag
                    .replace(&content, format!("<xmp:Label>{}</xmp:Label>", lbl))
                    .to_string();
            } else if let Some(last_index) = content.rfind("</rdf:Description>") {
                let (start, end) = content.split_at(last_index);
                content = format!("{} <xmp:Label>{}</xmp:Label>\n{}", start, lbl, end);
            }
        } else {
            let re_label_attr = Regex::new(r#"\s*xmp:Label\s*=\s*"[^"]*""#).unwrap();
            let re_label_tag = Regex::new(r#"\s*<xmp:Label\s*>[^<]*</xmp:Label>"#).unwrap();
            content = re_label_attr.replace_all(&content, "").to_string();
            content = re_label_tag.replace_all(&content, "").to_string();
        }

        // Flat keywords for dc:subject (strip user: prefix; keep leaf-friendly list)
        let mut flat_subjects: Vec<String> = Vec::new();
        let mut hierarchical: Vec<String> = Vec::new();
        for t in &normal_tags {
            let bare = t.strip_prefix("user:").unwrap_or(t.as_str());
            // color: already mapped to xmp:Label above; never put in subject
            if bare.starts_with("color:") {
                continue;
            }
            // flag:pick / flag:reject and stack:<id> stay in dc:subject for interop
            if bare.starts_with("flag:") || bare.starts_with("stack:") {
                if !flat_subjects.iter().any(|s| s == bare) {
                    flat_subjects.push(bare.to_string());
                }
                continue;
            }
            // hierarchical path uses | in LR XMP; we store /
            if bare.contains('/') {
                hierarchical.push(bare.replace('/', "|"));
            }
            // always include leaf in flat subject
            let leaf = bare.rsplit('/').next().unwrap_or(bare);
            if !leaf.is_empty() && !flat_subjects.iter().any(|s| s == leaf) {
                flat_subjects.push(leaf.to_string());
            }
        }

        let re_subject =
            Regex::new(r#"(?s)<dc:subject>\s*<rdf:Bag>.*?</rdf:Bag>\s*</dc:subject>"#).unwrap();
        if flat_subjects.is_empty() {
            content = re_subject.replace_all(&content, "").to_string();
        } else {
            let mut bag = String::from("<dc:subject>\n    <rdf:Bag>\n");
            for t in &flat_subjects {
                let esc = t
                    .replace('&', "&amp;")
                    .replace('<', "&lt;")
                    .replace('>', "&gt;");
                bag.push_str(&format!("     <rdf:li>{}</rdf:li>\n", esc));
            }
            bag.push_str("    </rdf:Bag>\n   </dc:subject>");

            if re_subject.is_match(&content) {
                content = re_subject.replace(&content, bag.as_str()).to_string();
            } else if let Some(last_index) = content.rfind("</rdf:Description>") {
                let (start, end) = content.split_at(last_index);
                content = format!("{} {}\n  {}", start, bag, end);
            }
        }

        // Lightroom hierarchical keywords (lr:hierarchicalSubject)
        content = ensure_xmlns(
            &content,
            "lr",
            "http://ns.adobe.com/lightroom/1.0/",
        );
        let re_hier = Regex::new(
            r#"(?s)<lr:hierarchicalSubject>\s*<rdf:Bag>.*?</rdf:Bag>\s*</lr:hierarchicalSubject>"#,
        )
        .unwrap();
        if hierarchical.is_empty() {
            content = re_hier.replace_all(&content, "").to_string();
        } else {
            let mut bag = String::from("<lr:hierarchicalSubject>\n    <rdf:Bag>\n");
            for t in &hierarchical {
                let esc = t
                    .replace('&', "&amp;")
                    .replace('<', "&lt;")
                    .replace('>', "&gt;");
                bag.push_str(&format!("     <rdf:li>{}</rdf:li>\n", esc));
            }
            bag.push_str("    </rdf:Bag>\n   </lr:hierarchicalSubject>");
            if re_hier.is_match(&content) {
                content = re_hier.replace(&content, bag.as_str()).to_string();
            } else if let Some(last_index) = content.rfind("</rdf:Description>") {
                let (start, end) = content.split_at(last_index);
                content = format!("{} {}\n  {}", start, bag, end);
            }
        }

        // Dublin Core IPTC-ish fields from RapidRAW exif map (LR-readable)
        content = ensure_dc_namespace(&content);
        if let Some(exif) = metadata.exif.as_ref() {
            // Caption/description vs title are distinct in LR (dc:description vs dc:title)
            let description = exif
                .get("ImageDescription")
                .or_else(|| exif.get("Description"))
                .or_else(|| exif.get("Caption"))
                .map(|s| s.as_str());
            let title = exif
                .get("XPTitle")
                .or_else(|| exif.get("Title"))
                .map(|s| s.as_str());
            let creator = exif
                .get("Artist")
                .or_else(|| exif.get("Creator"))
                .or_else(|| exif.get("XPAuthor"))
                .map(|s| s.as_str());
            let rights = exif
                .get("Copyright")
                .or_else(|| exif.get("Rights"))
                .or_else(|| exif.get("XPComment"))
                .map(|s| s.as_str());
            // Only overwrite when keys are present; empty string clears
            if exif.contains_key("ImageDescription")
                || exif.contains_key("Description")
                || exif.contains_key("Caption")
            {
                content = upsert_dc_alt_field(&content, "description", description);
            }
            if exif.contains_key("XPTitle") || exif.contains_key("Title") {
                content = upsert_dc_alt_field(&content, "title", title);
            }
            if exif.contains_key("Artist")
                || exif.contains_key("Creator")
                || exif.contains_key("XPAuthor")
            {
                content = upsert_dc_alt_field(&content, "creator", creator);
            }
            if exif.contains_key("Copyright")
                || exif.contains_key("Rights")
            {
                content = upsert_dc_alt_field(&content, "rights", rights);
            }

            // Location IPTC (photoshop + Iptc4xmpCore) — LR-readable
            content = ensure_xmlns(
                &content,
                "photoshop",
                "http://ns.adobe.com/photoshop/1.0/",
            );
            content = ensure_xmlns(
                &content,
                "Iptc4xmpCore",
                "http://iptc.org/std/Iptc4xmpCore/1.0/xmlns/",
            );
            let city = exif.get("City").map(|s| s.as_str());
            let country = exif.get("Country").map(|s| s.as_str());
            let location = exif
                .get("Location")
                .or_else(|| exif.get("SubLocation"))
                .map(|s| s.as_str());
            let state = exif
                .get("State")
                .or_else(|| exif.get("Province"))
                .map(|s| s.as_str());
            let headline = exif.get("Headline").map(|s| s.as_str());
            if exif.contains_key("City") {
                content = upsert_simple_xmp_field(&content, "photoshop", "City", city);
            }
            if exif.contains_key("Country") {
                content = upsert_simple_xmp_field(&content, "photoshop", "Country", country);
            }
            if exif.contains_key("State") || exif.contains_key("Province") {
                content = upsert_simple_xmp_field(&content, "photoshop", "State", state);
            }
            if exif.contains_key("Headline") {
                content = upsert_simple_xmp_field(&content, "photoshop", "Headline", headline);
            }
            let caption_writer = exif
                .get("CaptionWriter")
                .or_else(|| exif.get("Caption Writer"))
                .or_else(|| exif.get("Writer"))
                .map(|s| s.as_str());
            if exif.contains_key("CaptionWriter")
                || exif.contains_key("Caption Writer")
                || exif.contains_key("Writer")
            {
                content = upsert_simple_xmp_field(
                    &content,
                    "photoshop",
                    "CaptionWriter",
                    caption_writer,
                );
            }
            if exif.contains_key("Category") {
                let cat = exif.get("Category").map(|s| s.as_str());
                content = upsert_simple_xmp_field(&content, "photoshop", "Category", cat);
            }
            if exif.contains_key("Urgency") {
                let urg = exif.get("Urgency").map(|s| s.as_str());
                content = upsert_simple_xmp_field(&content, "photoshop", "Urgency", urg);
            }
            if exif.contains_key("SupplementalCategories")
                || exif.contains_key("Supplemental Categories")
            {
                let supp = exif
                    .get("SupplementalCategories")
                    .or_else(|| exif.get("Supplemental Categories"))
                    .map(|s| s.as_str())
                    .unwrap_or("");
                content = upsert_string_bag(
                    &content,
                    "photoshop",
                    "SupplementalCategories",
                    supp,
                );
            }
            let genre = exif
                .get("IntellectualGenre")
                .or_else(|| exif.get("Intellectual Genre"))
                .map(|s| s.as_str());
            if exif.contains_key("IntellectualGenre") || exif.contains_key("Intellectual Genre") {
                content = upsert_simple_xmp_field(
                    &content,
                    "Iptc4xmpCore",
                    "IntellectualGenre",
                    genre,
                );
            }
            content = ensure_xmlns(
                &content,
                "Iptc4xmpExt",
                "http://iptc.org/std/Iptc4xmpExt/2008-02-29/",
            );
            let event = exif.get("Event").map(|s| s.as_str());
            if exif.contains_key("Event") {
                // LR often uses Iptc4xmpExt:Event as alt-lang bag
                content = upsert_namespaced_alt_field(&content, "Iptc4xmpExt", "Event", event);
            }
            if exif.contains_key("DigitalSourceType")
                || exif.contains_key("Digital Source Type")
            {
                let dst = exif
                    .get("DigitalSourceType")
                    .or_else(|| exif.get("Digital Source Type"))
                    .map(|s| s.as_str());
                content = ensure_xmlns(
                    &content,
                    "Iptc4xmpExt",
                    "http://iptc.org/std/Iptc4xmpExt/2008-02-29/",
                );
                content = upsert_simple_xmp_field(
                    &content,
                    "Iptc4xmpExt",
                    "DigitalSourceType",
                    dst,
                );
            }
            if exif.contains_key("PersonInImage") || exif.contains_key("Person In Image") {
                let people = exif
                    .get("PersonInImage")
                    .or_else(|| exif.get("Person In Image"))
                    .map(|s| s.as_str())
                    .unwrap_or("");
                content = upsert_person_in_image_bag(&content, people);
            }
            if exif.contains_key("Scene") {
                let scene = exif.get("Scene").map(|s| s.as_str()).unwrap_or("");
                content = upsert_string_bag(
                    &content,
                    "Iptc4xmpCore",
                    "Scene",
                    scene,
                );
            }
            if exif.contains_key("SubjectCode") || exif.contains_key("Subject Code") {
                let codes = exif
                    .get("SubjectCode")
                    .or_else(|| exif.get("Subject Code"))
                    .map(|s| s.as_str())
                    .unwrap_or("");
                content = upsert_string_bag(
                    &content,
                    "Iptc4xmpCore",
                    "SubjectCode",
                    codes,
                );
            }
            let credit = exif.get("Credit").map(|s| s.as_str());
            let source = exif.get("Source").map(|s| s.as_str());
            if exif.contains_key("Credit") {
                content = upsert_simple_xmp_field(&content, "photoshop", "Credit", credit);
            }
            if exif.contains_key("Source") {
                content = upsert_simple_xmp_field(&content, "photoshop", "Source", source);
            }
            let instructions = exif.get("Instructions").map(|s| s.as_str());
            if exif.contains_key("Instructions") {
                content = upsert_simple_xmp_field(&content, "photoshop", "Instructions", instructions);
            }
            let job_id = exif
                .get("JobIdentifier")
                .or_else(|| exif.get("JobID"))
                .or_else(|| exif.get("Job Identifier"))
                .map(|s| s.as_str());
            if exif.contains_key("JobIdentifier")
                || exif.contains_key("JobID")
                || exif.contains_key("Job Identifier")
            {
                // LR IPTC "Job Identifier" maps to photoshop:TransmissionReference
                content = upsert_simple_xmp_field(
                    &content,
                    "photoshop",
                    "TransmissionReference",
                    job_id,
                );
                content = upsert_simple_xmp_field(&content, "photoshop", "JobIdentifier", job_id);
            }
            let authors_position = exif.get("AuthorsPosition").map(|s| s.as_str());
            if exif.contains_key("AuthorsPosition") {
                content =
                    upsert_simple_xmp_field(&content, "photoshop", "AuthorsPosition", authors_position);
            }
            let country_code = exif
                .get("CountryCode")
                .or_else(|| exif.get("Country Code"))
                .map(|s| s.as_str());
            if exif.contains_key("CountryCode") || exif.contains_key("Country Code") {
                content = upsert_simple_xmp_field(
                    &content,
                    "Iptc4xmpCore",
                    "CountryCode",
                    country_code,
                );
            }
            // Rights usage terms (xmpRights:UsageTerms) — LR IPTC/status
            content = ensure_xmlns(
                &content,
                "xmpRights",
                "http://ns.adobe.com/xap/1.0/rights/",
            );
            let usage_terms = exif
                .get("UsageTerms")
                .or_else(|| exif.get("Usage Terms"))
                .map(|s| s.as_str());
            if exif.contains_key("UsageTerms") || exif.contains_key("Usage Terms") {
                content = upsert_namespaced_alt_field(
                    &content,
                    "xmpRights",
                    "UsageTerms",
                    usage_terms,
                );
            }
            let web_statement = exif
                .get("WebStatement")
                .or_else(|| exif.get("Web Statement"))
                .map(|s| s.as_str());
            if exif.contains_key("WebStatement") || exif.contains_key("Web Statement") {
                content = upsert_simple_xmp_field(
                    &content,
                    "xmpRights",
                    "WebStatement",
                    web_statement,
                );
            }
            let creator_url = exif
                .get("CreatorWorkURL")
                .or_else(|| exif.get("Creator Work URL"))
                .or_else(|| exif.get("CiUrlWork"))
                .map(|s| s.as_str());
            if exif.contains_key("CreatorWorkURL")
                || exif.contains_key("Creator Work URL")
                || exif.contains_key("CiUrlWork")
            {
                content = ensure_xmlns(
                    &content,
                    "Iptc4xmpCore",
                    "http://iptc.org/std/Iptc4xmpCore/1.0/xmlns/",
                );
                content = upsert_simple_xmp_field(
                    &content,
                    "Iptc4xmpCore",
                    "CreatorWorkURL",
                    creator_url,
                );
                content =
                    upsert_simple_xmp_field(&content, "Iptc4xmpCore", "CiUrlWork", creator_url);
            }
            let creator_email = exif
                .get("CiEmailWork")
                .or_else(|| exif.get("Creator Email"))
                .or_else(|| exif.get("Email"))
                .map(|s| s.as_str());
            if exif.contains_key("CiEmailWork")
                || exif.contains_key("Creator Email")
                || exif.contains_key("Email")
            {
                content = ensure_xmlns(
                    &content,
                    "Iptc4xmpCore",
                    "http://iptc.org/std/Iptc4xmpCore/1.0/xmlns/",
                );
                content = upsert_simple_xmp_field(
                    &content,
                    "Iptc4xmpCore",
                    "CiEmailWork",
                    creator_email,
                );
            }
            let creator_phone = exif
                .get("CiTelWork")
                .or_else(|| exif.get("Creator Phone"))
                .or_else(|| exif.get("Phone"))
                .map(|s| s.as_str());
            if exif.contains_key("CiTelWork")
                || exif.contains_key("Creator Phone")
                || exif.contains_key("Phone")
            {
                content = ensure_xmlns(
                    &content,
                    "Iptc4xmpCore",
                    "http://iptc.org/std/Iptc4xmpCore/1.0/xmlns/",
                );
                content = upsert_simple_xmp_field(
                    &content,
                    "Iptc4xmpCore",
                    "CiTelWork",
                    creator_phone,
                );
            }
            // Creator postal address (Iptc4xmpCore contact)
            content = ensure_xmlns(
                &content,
                "Iptc4xmpCore",
                "http://iptc.org/std/Iptc4xmpCore/1.0/xmlns/",
            );
            for (key, tag) in [
                ("CiAdrExtadr", "CiAdrExtadr"),
                ("Creator Address", "CiAdrExtadr"),
                ("CiAdrCity", "CiAdrCity"),
                ("CiAdrRegion", "CiAdrRegion"),
                ("CiAdrPcode", "CiAdrPcode"),
                ("CiAdrCtry", "CiAdrCtry"),
            ] {
                if exif.contains_key(key) {
                    let v = exif.get(key).map(|s| s.as_str());
                    content = upsert_simple_xmp_field(&content, "Iptc4xmpCore", tag, v);
                }
            }
            // Copyright status → xmpRights:Marked (True=copyrighted, False=public domain)
            if exif.contains_key("CopyrightStatus") || exif.contains_key("Copyright Status") {
                let status = exif
                    .get("CopyrightStatus")
                    .or_else(|| exif.get("Copyright Status"))
                    .map(|s| s.as_str())
                    .unwrap_or("");
                let marked = if status.eq_ignore_ascii_case("Copyrighted")
                    || status.eq_ignore_ascii_case("True")
                    || status == "true"
                {
                    Some("True")
                } else if status.eq_ignore_ascii_case("Public Domain")
                    || status.eq_ignore_ascii_case("False")
                    || status == "false"
                {
                    Some("False")
                } else {
                    // Unknown / empty → remove Marked
                    None
                };
                // Also store human label as simple field for roundtrip
                content = upsert_simple_xmp_field(
                    &content,
                    "photoshop",
                    "CopyrightStatus",
                    if status.is_empty() { None } else { Some(status) },
                );
                content = upsert_simple_xmp_field(&content, "xmpRights", "Marked", marked);
            }
            // Capture date for LR Library (photoshop:DateCreated)
            let date_created = exif
                .get("DateTimeOriginal")
                .or_else(|| exif.get("CreateDate"))
                .or_else(|| exif.get("DateTime"))
                .map(|s| s.as_str());
            if exif.contains_key("DateTimeOriginal")
                || exif.contains_key("CreateDate")
                || exif.contains_key("DateTime")
            {
                if let Some(raw) = date_created {
                    // Normalize EXIF "YYYY:MM:DD HH:MM:SS" → "YYYY-MM-DDTHH:MM:SS"
                    let norm = raw.trim().replace(' ', "T");
                    let norm = if norm.len() >= 10 && norm.as_bytes().get(4) == Some(&b':') {
                        // YYYY:MM:DD...
                        let mut chars: Vec<char> = norm.chars().collect();
                        if chars.len() > 4 { chars[4] = '-'; }
                        if chars.len() > 7 { chars[7] = '-'; }
                        chars.into_iter().collect::<String>()
                    } else {
                        norm
                    };
                    content = upsert_simple_xmp_field(
                        &content,
                        "photoshop",
                        "DateCreated",
                        Some(norm.as_str()),
                    );
                }
            }
            if exif.contains_key("Location") || exif.contains_key("SubLocation") {
                content =
                    upsert_simple_xmp_field(&content, "Iptc4xmpCore", "Location", location);
            }
        }

        // Write develop crs:* settings when present (Lightroom-compatible sidecar)
        content = merge_develop_into_xmp(&content, &metadata.adjustments);

        let _ = fs::write(&xmp_file, content);
    }
}


#[cfg(test)]
mod xmp_sidecar_tests {
    use super::*;
    use crate::image_processing::ImageMetadata;
    use crate::preset_converter::convert_adjustments_to_xmp;

    #[test]
    fn sidecar_develop_import_from_xmp() {
        let dir = std::env::temp_dir().join(format!("rustroom_sidecar_{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let img = dir.join("photo.ARW");
        fs::write(&img, b"not-a-real-raw").unwrap();
        let xmp_body = convert_adjustments_to_xmp(
            "SidecarLook",
            &serde_json::json!({
                "exposure": 0.4,
                "contrast": 12,
                "highlights": -20,
                "saturation": 5
            }),
        );
        fs::write(dir.join("photo.xmp"), xmp_body).unwrap();

        let mut meta = ImageMetadata::default();
        assert!(meta.adjustments.is_null());
        let changed = sync_metadata_from_xmp(&img, &mut meta);
        assert!(changed, "should import develop from sidecar");
        let adj = meta.adjustments.as_object().expect("adjustments object");
        assert!(adj.contains_key("contrast") || adj.contains_key("exposure") || adj.contains_key("highlights"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn sidecar_does_not_overwrite_existing_adjustments() {
        let dir = std::env::temp_dir().join(format!("rustroom_sidecar2_{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let img = dir.join("photo2.ARW");
        fs::write(&img, b"raw").unwrap();
        let xmp_body = convert_adjustments_to_xmp(
            "Other",
            &serde_json::json!({"exposure": 1.0, "contrast": 50}),
        );
        fs::write(dir.join("photo2.xmp"), xmp_body).unwrap();

        let mut meta = ImageMetadata::default();
        meta.adjustments = serde_json::json!({"exposure": -0.5, "contrast": 1, "custom": true});
        let _changed = sync_metadata_from_xmp(&img, &mut meta);
        let adj = meta.adjustments.as_object().unwrap();
        // existing non-empty develop must be preserved
        assert_eq!(adj.get("custom").and_then(|v| v.as_bool()), Some(true));
        assert!((adj.get("exposure").and_then(|v| v.as_f64()).unwrap() - (-0.5)).abs() < 0.01);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn sidecar_develop_export_to_xmp() {
        let dir = std::env::temp_dir().join(format!("rustroom_sidecar_out_{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let img = dir.join("out.ARW");
        fs::write(&img, b"raw").unwrap();
        // start with minimal xmp
        let skeleton = r#"<?xml version="1.0" encoding="UTF-8"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
    xmlns:xmp="http://ns.adobe.com/xap/1.0/">
   <xmp:Rating>0</xmp:Rating>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>"#;
        fs::write(dir.join("out.xmp"), skeleton).unwrap();

        let mut meta = ImageMetadata::default();
        meta.rating = 3;
        meta.adjustments = serde_json::json!({
            "exposure": 0.25,
            "contrast": 15,
            "dehaze": 10,
            "vibrance": 5
        });
        sync_metadata_to_xmp(&img, &meta, false);
        let written = fs::read_to_string(dir.join("out.xmp")).unwrap();
        assert!(written.contains("crs:"), "should contain crs namespace/attrs");
        assert!(written.contains("Exposure2012") || written.contains("Contrast2012"));
        assert!(written.contains("HasSettings") || written.contains("exposure") || written.contains("Contrast"));
        // rating must survive develop merge
        assert!(
            written.contains("xmp:Rating") && written.contains('3'),
            "rating 3 should remain in sidecar after develop merge"
        );
        // re-import into empty meta
        let mut meta2 = ImageMetadata::default();
        assert!(sync_metadata_from_xmp(&img, &mut meta2));
        let adj = meta2.adjustments.as_object().unwrap();
        assert!(adj.contains_key("contrast") || adj.contains_key("exposure") || adj.contains_key("dehaze"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn sidecar_create_missing_with_develop() {
        let dir = std::env::temp_dir().join(format!("rustroom_sidecar_create_{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let img = dir.join("newfile.ARW");
        fs::write(&img, b"raw").unwrap();
        // no xmp yet
        assert!(!dir.join("newfile.xmp").exists());

        let mut meta = ImageMetadata::default();
        meta.rating = 2;
        meta.adjustments = serde_json::json!({"exposure": 0.1, "contrast": 8, "whites": 5});
        sync_metadata_to_xmp(&img, &meta, true);
        assert!(dir.join("newfile.xmp").exists());
        let written = fs::read_to_string(dir.join("newfile.xmp")).unwrap();
        assert!(written.contains("crs:"));
        assert!(written.contains("Exposure2012") || written.contains("Contrast2012") || written.contains("Whites2012"));

        let mut meta2 = ImageMetadata::default();
        assert!(sync_metadata_from_xmp(&img, &mut meta2));
        let adj = meta2.adjustments.as_object().unwrap();
        assert!(adj.contains_key("contrast") || adj.contains_key("exposure") || adj.contains_key("whites"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn reimport_develop_overwrites_existing() {
        let dir = std::env::temp_dir().join(format!("rustroom_reimport_{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let img = dir.join("shot.ARW");
        fs::write(&img, b"raw").unwrap();
        let xmp = convert_adjustments_to_xmp(
            "FromLR",
            &serde_json::json!({"exposure": 0.8, "contrast": 22, "dehaze": 7}),
        );
        fs::write(dir.join("shot.xmp"), xmp).unwrap();

        // Seed RR sidecar with different adjustments
        // parse_virtual_path uses filename.rrdata next to file - check convention
        let mut meta = ImageMetadata::default();
        meta.rating = 4;
        meta.adjustments = serde_json::json!({"exposure": -1.0, "contrast": 0, "custom": true});
        // write sidecar where parse_virtual_path expects
        let (_src, sc) = parse_virtual_path(&img.to_string_lossy());
        let json = serde_json::to_string_pretty(&meta).unwrap();
        fs::write(&sc, json).unwrap();

        // Directly exercise reimport logic without AppHandle: call convert + write like command
        let content = fs::read_to_string(dir.join("shot.xmp")).unwrap();
        let preset = crate::preset_converter::convert_xmp_to_preset(&content).unwrap();
        let mut loaded = crate::exif_processing::load_sidecar(&sc);
        let rating = loaded.rating;
        loaded.adjustments = preset.adjustments.clone();
        if rating > 0 {
            if let Some(obj) = loaded.adjustments.as_object_mut() {
                obj.insert("rating".to_string(), serde_json::json!(rating));
            }
        }
        fs::write(&sc, serde_json::to_string_pretty(&loaded).unwrap()).unwrap();

        let final_meta = crate::exif_processing::load_sidecar(&sc);
        assert_eq!(final_meta.rating, 4, "rating preserved");
        let adj = final_meta.adjustments.as_object().unwrap();
        assert!(adj.get("custom").is_none() || adj.get("contrast").and_then(|v| v.as_f64()).unwrap_or(0.0) > 1.0);
        assert!(adj.contains_key("contrast") || adj.contains_key("exposure") || adj.contains_key("dehaze"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn reimport_batch_counts_ok_and_fail() {
        let dir = std::env::temp_dir().join(format!("rustroom_reimport_batch_{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        let good = dir.join("good.ARW");
        fs::write(&good, b"raw").unwrap();
        let xmp = convert_adjustments_to_xmp(
            "Batch",
            &serde_json::json!({"exposure": 0.3, "contrast": 11}),
        );
        fs::write(dir.join("good.xmp"), xmp).unwrap();

        let bad = dir.join("bad.ARW");
        fs::write(&bad, b"raw").unwrap();

        let result = reimport_develop_from_xmp_paths(vec![
            good.to_string_lossy().to_string(),
            bad.to_string_lossy().to_string(),
        ])
        .unwrap();
        assert_eq!(result["ok"], 1);
        assert_eq!(result["fail"], 1);
        let ok_paths = result["okPaths"].as_array().unwrap();
        assert_eq!(ok_paths.len(), 1);
        assert!(ok_paths[0].as_str().unwrap().contains("good.ARW"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn resolve_xmp_path_finds_sidecar() {
        let dir = std::env::temp_dir().join(format!("rustroom_resolve_xmp_{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let img = dir.join("pic.ARW");
        fs::write(&img, b"raw").unwrap();
        assert!(resolve_xmp_path(&img).is_none());
        fs::write(dir.join("pic.xmp"), "<x:xmpmeta/>").unwrap();
        let found = resolve_xmp_path(&img).expect("xmp");
        assert!(found.ends_with("pic.xmp"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn imported_develop_marks_edited() {
        let dir = std::env::temp_dir().join(format!("rustroom_edited_flag_{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let img = dir.join("editme.ARW");
        fs::write(&img, b"raw").unwrap();
        let xmp = convert_adjustments_to_xmp(
            "EditedLook",
            &serde_json::json!({"exposure": 0.55, "contrast": 18, "vibrance": 12}),
        );
        fs::write(dir.join("editme.xmp"), xmp).unwrap();

        let mut meta = ImageMetadata::default();
        assert!(sync_metadata_from_xmp(&img, &mut meta));
        let is_raw = true;
        let edited = crate::image_processing::is_image_edited(&meta.adjustments, is_raw, None);
        assert!(edited, "develop from XMP should mark image edited");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn merge_preserves_non_crs_metadata() {
        let skeleton = r#"<?xml version="1.0" encoding="UTF-8"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
    xmlns:xmp="http://ns.adobe.com/xap/1.0/"
    xmlns:dc="http://purl.org/dc/elements/1.1/">
   <xmp:Rating>5</xmp:Rating>
   <dc:subject>
    <rdf:Bag>
     <rdf:li>holiday</rdf:li>
     <rdf:li>family</rdf:li>
    </rdf:Bag>
   </dc:subject>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>"#;
        let adj = serde_json::json!({
            "exposure": 0.2,
            "contrast": 10,
            "vibrance": 5
        });
        let merged = merge_develop_into_xmp(skeleton, &adj);
        assert!(merged.contains("<xmp:Rating>5</xmp:Rating>") || merged.contains("xmp:Rating"), "rating preserved");
        assert!(merged.contains("holiday"), "keyword preserved");
        assert!(merged.contains("family"), "keyword preserved");
        assert!(merged.contains("crs:") || merged.contains("Exposure2012") || merged.contains("Contrast2012"));
        assert!(merged.contains("xmlns:crs") || merged.contains("camera-raw-settings"));
    }

    #[test]
    fn export_develop_to_xmp_writes_sidecar() {
        let dir = std::env::temp_dir().join(format!("rr_export_xmp_{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let photo = dir.join("shot.arw");
        fs::write(&photo, b"fake-arw").unwrap();
        let mut meta = ImageMetadata::default();
        meta.rating = 4;
        meta.adjustments = serde_json::json!({
            "exposure": 0.75,
            "contrast": 20
        });
        // Explicit export path: always create missing XMP with develop
        sync_metadata_to_xmp(&photo, &meta, true);
        let xmp_path = resolve_xmp_path(&photo).expect("xmp should exist");
        let content = fs::read_to_string(&xmp_path).unwrap();
        assert!(
            content.contains("Exposure2012") || content.contains("crs:"),
            "develop crs in xmp"
        );
        assert!(
            content.contains("Rating") || content.contains("xmp:Rating") || content.contains('4'),
            "rating written"
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn import_dest_xmp_naming_matches_source_style() {
        let dir = std::env::temp_dir().join(format!("rr_import_xmp_{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let src_dir = dir.join("src");
        let dst_dir = dir.join("dst");
        fs::create_dir_all(&src_dir).unwrap();
        fs::create_dir_all(&dst_dir).unwrap();

        // Style A: photo.xmp next to photo.ARW
        let photo_a = src_dir.join("a.ARW");
        fs::write(&photo_a, b"raw-a").unwrap();
        fs::write(src_dir.join("a.xmp"), b"<x:xmpmeta>A</x:xmpmeta>").unwrap();
        assert!(resolve_xmp_path(&photo_a).is_some());

        // Style B: photo.ARW.xmp
        let photo_b = src_dir.join("b.ARW");
        fs::write(&photo_b, b"raw-b").unwrap();
        fs::write(src_dir.join("b.ARW.xmp"), b"<x:xmpmeta>B</x:xmpmeta>").unwrap();
        assert!(resolve_xmp_path(&photo_b).is_some());

        // Simulate copy naming used in import_files
        for (photo, tag) in [(&photo_a, "A"), (&photo_b, "B")] {
            let src_xmp = resolve_xmp_path(photo).expect("xmp resolve");
            let dest_file = dst_dir.join(photo.file_name().unwrap());
            fs::copy(photo, &dest_file).unwrap();
            let dest_xmp = mirror_xmp_dest_path(&dest_file, &src_xmp, photo);
            fs::copy(&src_xmp, &dest_xmp).unwrap();
            let body = fs::read_to_string(&dest_xmp).unwrap();
            assert!(body.contains(tag), "dest xmp should match source content {}", tag);
            // destination should also resolve via resolve_xmp_path
            assert!(
                resolve_xmp_path(&dest_file).is_some(),
                "dest image should resolve xmp"
            );
        }
        let _ = fs::remove_dir_all(&dir);
    }

    
    #[test]
    fn dc_description_copyright_xmp_roundtrip() {
        let dir = std::env::temp_dir().join(format!("rustroom_dc_xmp_{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let photo = dir.join("meta.ARW");
        fs::write(&photo, b"raw").unwrap();

        let mut meta = ImageMetadata::default();
        let mut exif = std::collections::HashMap::new();
        exif.insert("ImageDescription".to_string(), "Golden hour skyline".to_string());
        exif.insert("Artist".to_string(), "Ada Lovelace".to_string());
        exif.insert("Copyright".to_string(), "© 2024 Ada".to_string());
        meta.exif = Some(exif);
        meta.rating = 4;

        sync_metadata_to_xmp(&photo, &meta, true);
        let xmp_path = dir.join("meta.xmp");
        assert!(xmp_path.exists(), "xmp created");
        let written = fs::read_to_string(&xmp_path).unwrap();
        assert!(written.contains("dc:description"), "description: {}", written);
        assert!(written.contains("Golden hour skyline"), "desc text");
        assert!(written.contains("dc:creator"), "creator");
        assert!(written.contains("Ada Lovelace"), "artist");
        assert!(written.contains("dc:rights"), "rights");
        assert!(written.contains("© 2024 Ada") || written.contains("&copy;") || written.contains("2024 Ada"), "copyright text");

        let mut loaded = ImageMetadata::default();
        let changed = sync_metadata_from_xmp(&photo, &mut loaded);
        assert!(changed, "should import DC fields");
        let e = loaded.exif.expect("exif map");
        assert_eq!(e.get("ImageDescription").map(|s| s.as_str()), Some("Golden hour skyline"));
        assert_eq!(e.get("Artist").map(|s| s.as_str()), Some("Ada Lovelace"));
        assert_eq!(e.get("Copyright").map(|s| s.as_str()), Some("© 2024 Ada"));
        let _ = fs::remove_dir_all(&dir);
    }


    #[test]
    fn sidecar_writes_dc_title_separate_from_description() {
        let dir = std::env::temp_dir().join(format!("rustroom_dc_title_{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let photo = dir.join("meta.ARW");
        fs::write(&photo, b"raw").unwrap();

        let mut meta = ImageMetadata::default();
        let mut exif = std::collections::HashMap::new();
        exif.insert("ImageDescription".to_string(), "Caption body".to_string());
        exif.insert("XPTitle".to_string(), "Short Title".to_string());
        meta.exif = Some(exif);

        sync_metadata_to_xmp(&photo, &meta, true);
        let written = fs::read_to_string(dir.join("meta.xmp")).unwrap();
        assert!(
            written.contains("dc:description") && written.contains("Caption body"),
            "description: {}",
            &written[..written.len().min(600)]
        );
        assert!(
            written.contains("dc:title") && written.contains("Short Title"),
            "title: {}",
            &written[..written.len().min(600)]
        );
        let desc = extract_dc_alt_text(&written, "description").unwrap_or_default();
        let title = extract_dc_alt_text(&written, "title").unwrap_or_default();
        assert_eq!(desc, "Caption body");
        assert_eq!(title, "Short Title");

        let mut loaded = ImageMetadata::default();
        let changed = sync_metadata_from_xmp(&photo, &mut loaded);
        assert!(changed, "should import DC title/description");
        let e = loaded.exif.expect("exif");
        assert_eq!(e.get("ImageDescription").map(|s| s.as_str()), Some("Caption body"));
        assert_eq!(e.get("XPTitle").map(|s| s.as_str()), Some("Short Title"));
        let _ = fs::remove_dir_all(&dir);
    }


    #[test]
    fn sidecar_date_created_roundtrip() {
        let dir = std::env::temp_dir().join(format!("rustroom_date_xmp_{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let photo = dir.join("shot.ARW");
        fs::write(&photo, b"raw").unwrap();

        let mut meta = ImageMetadata::default();
        let mut exif = std::collections::HashMap::new();
        exif.insert(
            "DateTimeOriginal".to_string(),
            "2024:06:15 18:30:00".to_string(),
        );
        exif.insert("City".to_string(), "Lyon".to_string());
        meta.exif = Some(exif);

        sync_metadata_to_xmp(&photo, &meta, true);
        let written = fs::read_to_string(dir.join("shot.xmp")).unwrap();
        assert!(
            written.contains("DateCreated")
                && (written.contains("2024-06-15") || written.contains("2024:06:15")),
            "DateCreated: {}",
            &written[..written.len().min(700)]
        );
        assert!(
            written.contains("Lyon")
                && (written.contains("photoshop:City") || written.contains("<photoshop:City>")),
            "city: {}",
            &written[..written.len().min(700)]
        );

        // Fresh load without exif — should import DateCreated + City
        let mut loaded = ImageMetadata::default();
        let changed = sync_metadata_from_xmp(&photo, &mut loaded);
        assert!(changed, "should import date/city");
        let e = loaded.exif.expect("exif");
        let dto = e.get("DateTimeOriginal").map(|s| s.as_str()).unwrap_or("");
        assert!(
            dto.contains("2024") && dto.contains("06") && dto.contains("15"),
            "DateTimeOriginal imported: {}",
            dto
        );
        assert_eq!(e.get("City").map(|s| s.as_str()), Some("Lyon"));
        let _ = fs::remove_dir_all(&dir);
    }


    #[test]
    fn sidecar_credit_source_roundtrip() {
        let dir = std::env::temp_dir().join(format!("rustroom_credit_{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let photo = dir.join("c.ARW");
        fs::write(&photo, b"raw").unwrap();
        let mut meta = ImageMetadata::default();
        let mut exif = std::collections::HashMap::new();
        exif.insert("Credit".to_string(), "Agency X".to_string());
        exif.insert("Source".to_string(), "Archive".to_string());
        meta.exif = Some(exif);
        sync_metadata_to_xmp(&photo, &meta, true);
        let written = fs::read_to_string(dir.join("c.xmp")).unwrap();
        assert!(
            written.contains("Credit") && written.contains("Agency X"),
            "credit: {}",
            &written[..written.len().min(600)]
        );
        assert!(
            written.contains("Source") && written.contains("Archive"),
            "source: {}",
            &written[..written.len().min(600)]
        );
        let mut loaded = ImageMetadata::default();
        assert!(sync_metadata_from_xmp(&photo, &mut loaded));
        let e = loaded.exif.expect("exif");
        assert_eq!(e.get("Credit").map(|s| s.as_str()), Some("Agency X"));
        assert_eq!(e.get("Source").map(|s| s.as_str()), Some("Archive"));
        let _ = fs::remove_dir_all(&dir);
    }


    #[test]
    fn sidecar_instructions_roundtrip() {
        let dir = std::env::temp_dir().join(format!("rustroom_instr_{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let photo = dir.join("i.ARW");
        fs::write(&photo, b"raw").unwrap();
        let mut meta = ImageMetadata::default();
        let mut exif = std::collections::HashMap::new();
        exif.insert("Instructions".to_string(), "Do not crop faces".to_string());
        meta.exif = Some(exif);
        sync_metadata_to_xmp(&photo, &meta, true);
        let written = fs::read_to_string(dir.join("i.xmp")).unwrap();
        assert!(
            written.contains("Instructions") && written.contains("Do not crop faces"),
            "instructions: {}",
            &written[..written.len().min(600)]
        );
        let mut loaded = ImageMetadata::default();
        assert!(sync_metadata_from_xmp(&photo, &mut loaded));
        let e = loaded.exif.expect("exif");
        assert_eq!(
            e.get("Instructions").map(|s| s.as_str()),
            Some("Do not crop faces")
        );
        let _ = fs::remove_dir_all(&dir);
    }


    #[test]
    fn sidecar_authors_country_code_roundtrip() {
        let dir = std::env::temp_dir().join(format!("rustroom_apcc_{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let photo = dir.join("a.ARW");
        fs::write(&photo, b"raw").unwrap();
        let mut meta = ImageMetadata::default();
        let mut exif = std::collections::HashMap::new();
        exif.insert("AuthorsPosition".to_string(), "Staff Photographer".to_string());
        exif.insert("CountryCode".to_string(), "FRA".to_string());
        meta.exif = Some(exif);
        sync_metadata_to_xmp(&photo, &meta, true);
        let written = fs::read_to_string(dir.join("a.xmp")).unwrap();
        assert!(
            written.contains("AuthorsPosition") && written.contains("Staff Photographer"),
            "authors: {}",
            &written[..written.len().min(600)]
        );
        assert!(
            written.contains("CountryCode") && written.contains("FRA"),
            "country code: {}",
            &written[..written.len().min(600)]
        );
        let mut loaded = ImageMetadata::default();
        assert!(sync_metadata_from_xmp(&photo, &mut loaded));
        let e = loaded.exif.expect("exif");
        assert_eq!(
            e.get("AuthorsPosition").map(|s| s.as_str()),
            Some("Staff Photographer")
        );
        assert_eq!(e.get("CountryCode").map(|s| s.as_str()), Some("FRA"));
        let _ = fs::remove_dir_all(&dir);
    }


    #[test]
    fn sidecar_usage_terms_roundtrip() {
        let dir = std::env::temp_dir().join(format!("rustroom_usage_{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let photo = dir.join("u.ARW");
        fs::write(&photo, b"raw").unwrap();
        let mut meta = ImageMetadata::default();
        let mut exif = std::collections::HashMap::new();
        exif.insert(
            "UsageTerms".to_string(),
            "Editorial use only".to_string(),
        );
        meta.exif = Some(exif);
        sync_metadata_to_xmp(&photo, &meta, true);
        let written = fs::read_to_string(dir.join("u.xmp")).unwrap();
        assert!(
            written.contains("UsageTerms") && written.contains("Editorial use only"),
            "usage: {}",
            &written[..written.len().min(700)]
        );
        let mut loaded = ImageMetadata::default();
        assert!(sync_metadata_from_xmp(&photo, &mut loaded));
        let e = loaded.exif.expect("exif");
        assert_eq!(
            e.get("UsageTerms").map(|s| s.as_str()),
            Some("Editorial use only")
        );
        let _ = fs::remove_dir_all(&dir);
    }


    #[test]
    fn sidecar_web_statement_copyright_status_roundtrip() {
        let dir = std::env::temp_dir().join(format!("rustroom_webstmt_{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let photo = dir.join("w.ARW");
        fs::write(&photo, b"raw").unwrap();
        let mut meta = ImageMetadata::default();
        let mut exif = std::collections::HashMap::new();
        exif.insert(
            "WebStatement".to_string(),
            "https://example.com/rights".to_string(),
        );
        exif.insert("CopyrightStatus".to_string(), "Copyrighted".to_string());
        meta.exif = Some(exif);
        sync_metadata_to_xmp(&photo, &meta, true);
        let written = fs::read_to_string(dir.join("w.xmp")).unwrap();
        assert!(
            written.contains("WebStatement") && written.contains("example.com/rights"),
            "web: {}",
            &written[..written.len().min(700)]
        );
        assert!(
            written.contains("Marked") && written.contains("True"),
            "marked: {}",
            &written[..written.len().min(700)]
        );
        let mut loaded = ImageMetadata::default();
        assert!(sync_metadata_from_xmp(&photo, &mut loaded));
        let e = loaded.exif.expect("exif");
        assert_eq!(
            e.get("WebStatement").map(|s| s.as_str()),
            Some("https://example.com/rights")
        );
        assert_eq!(
            e.get("CopyrightStatus").map(|s| s.as_str()),
            Some("Copyrighted")
        );
        let _ = fs::remove_dir_all(&dir);
    }


    #[test]
    fn sidecar_intellectual_genre_roundtrip() {
        let dir = std::env::temp_dir().join(format!("rustroom_genre_{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let photo = dir.join("g.ARW");
        fs::write(&photo, b"raw").unwrap();
        let mut meta = ImageMetadata::default();
        let mut exif = std::collections::HashMap::new();
        exif.insert("IntellectualGenre".to_string(), "Feature".to_string());
        meta.exif = Some(exif);
        sync_metadata_to_xmp(&photo, &meta, true);
        let written = fs::read_to_string(dir.join("g.xmp")).unwrap();
        assert!(
            written.contains("IntellectualGenre") && written.contains("Feature"),
            "genre: {}",
            &written[..written.len().min(600)]
        );
        let mut loaded = ImageMetadata::default();
        assert!(sync_metadata_from_xmp(&photo, &mut loaded));
        let e = loaded.exif.expect("exif");
        assert_eq!(e.get("IntellectualGenre").map(|s| s.as_str()), Some("Feature"));
        let _ = fs::remove_dir_all(&dir);
    }


    #[test]
    fn sidecar_event_roundtrip() {
        let dir = std::env::temp_dir().join(format!("rustroom_event_{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let photo = dir.join("e.ARW");
        fs::write(&photo, b"raw").unwrap();
        let mut meta = ImageMetadata::default();
        let mut exif = std::collections::HashMap::new();
        exif.insert("Event".to_string(), "Summer Festival 2024".to_string());
        meta.exif = Some(exif);
        sync_metadata_to_xmp(&photo, &meta, true);
        let written = fs::read_to_string(dir.join("e.xmp")).unwrap();
        assert!(
            written.contains("Event") && written.contains("Summer Festival 2024"),
            "event: {}",
            &written[..written.len().min(700)]
        );
        assert!(
            written.contains("Iptc4xmpExt") || written.contains("xmlns:Iptc4xmpExt"),
            "ext ns: {}",
            &written[..written.len().min(400)]
        );
        let mut loaded = ImageMetadata::default();
        assert!(sync_metadata_from_xmp(&photo, &mut loaded));
        let e = loaded.exif.expect("exif");
        assert_eq!(
            e.get("Event").map(|s| s.as_str()),
            Some("Summer Festival 2024")
        );
        let _ = fs::remove_dir_all(&dir);
    }


    #[test]
    fn sidecar_person_in_image_roundtrip() {
        let dir = std::env::temp_dir().join(format!("rustroom_people_{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let photo = dir.join("p.ARW");
        fs::write(&photo, b"raw").unwrap();
        let mut meta = ImageMetadata::default();
        let mut exif = std::collections::HashMap::new();
        exif.insert(
            "PersonInImage".to_string(),
            "Ada Lovelace, Alan Turing".to_string(),
        );
        meta.exif = Some(exif);
        sync_metadata_to_xmp(&photo, &meta, true);
        let written = fs::read_to_string(dir.join("p.xmp")).unwrap();
        assert!(
            written.contains("PersonInImage")
                && written.contains("Ada Lovelace")
                && written.contains("Alan Turing"),
            "people: {}",
            &written[..written.len().min(800)]
        );
        let mut loaded = ImageMetadata::default();
        assert!(sync_metadata_from_xmp(&photo, &mut loaded));
        let e = loaded.exif.expect("exif");
        let people = e.get("PersonInImage").map(|s| s.as_str()).unwrap_or("");
        assert!(
            people.contains("Ada Lovelace") && people.contains("Alan Turing"),
            "imported: {}",
            people
        );
        let _ = fs::remove_dir_all(&dir);
    }


    #[test]
    fn sidecar_scene_roundtrip() {
        let dir = std::env::temp_dir().join(format!("rustroom_scene_{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let photo = dir.join("s.ARW");
        fs::write(&photo, b"raw").unwrap();
        let mut meta = ImageMetadata::default();
        let mut exif = std::collections::HashMap::new();
        exif.insert("Scene".to_string(), "Landscape, Outdoor".to_string());
        meta.exif = Some(exif);
        sync_metadata_to_xmp(&photo, &meta, true);
        let written = fs::read_to_string(dir.join("s.xmp")).unwrap();
        assert!(
            written.contains("Scene")
                && written.contains("Landscape")
                && written.contains("Outdoor"),
            "scene: {}",
            &written[..written.len().min(700)]
        );
        let mut loaded = ImageMetadata::default();
        assert!(sync_metadata_from_xmp(&photo, &mut loaded));
        let e = loaded.exif.expect("exif");
        let scene = e.get("Scene").map(|s| s.as_str()).unwrap_or("");
        assert!(
            scene.contains("Landscape") && scene.contains("Outdoor"),
            "imported: {}",
            scene
        );
        let _ = fs::remove_dir_all(&dir);
    }


    #[test]
    fn sidecar_subject_code_roundtrip() {
        let dir = std::env::temp_dir().join(format!("rustroom_subj_{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let photo = dir.join("c.ARW");
        fs::write(&photo, b"raw").unwrap();
        let mut meta = ImageMetadata::default();
        let mut exif = std::collections::HashMap::new();
        exif.insert("SubjectCode".to_string(), "15062000, 15005000".to_string());
        meta.exif = Some(exif);
        sync_metadata_to_xmp(&photo, &meta, true);
        let written = fs::read_to_string(dir.join("c.xmp")).unwrap();
        assert!(
            written.contains("SubjectCode")
                && written.contains("15062000")
                && written.contains("15005000"),
            "subject: {}",
            &written[..written.len().min(700)]
        );
        let mut loaded = ImageMetadata::default();
        assert!(sync_metadata_from_xmp(&photo, &mut loaded));
        let e = loaded.exif.expect("exif");
        let codes = e.get("SubjectCode").map(|s| s.as_str()).unwrap_or("");
        assert!(
            codes.contains("15062000") && codes.contains("15005000"),
            "imported: {}",
            codes
        );
        let _ = fs::remove_dir_all(&dir);
    }


    #[test]
    fn sidecar_creator_work_url_roundtrip() {
        let dir = std::env::temp_dir().join(format!("rustroom_curl_{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let photo = dir.join("u.ARW");
        fs::write(&photo, b"raw").unwrap();
        let mut meta = ImageMetadata::default();
        let mut exif = std::collections::HashMap::new();
        exif.insert(
            "CreatorWorkURL".to_string(),
            "https://photographer.example".to_string(),
        );
        meta.exif = Some(exif);
        sync_metadata_to_xmp(&photo, &meta, true);
        let written = fs::read_to_string(dir.join("u.xmp")).unwrap();
        assert!(
            written.contains("photographer.example")
                && (written.contains("CreatorWorkURL") || written.contains("CiUrlWork")),
            "url: {}",
            &written[..written.len().min(700)]
        );
        let mut loaded = ImageMetadata::default();
        assert!(sync_metadata_from_xmp(&photo, &mut loaded));
        let e = loaded.exif.expect("exif");
        assert_eq!(
            e.get("CreatorWorkURL").map(|s| s.as_str()),
            Some("https://photographer.example")
        );
        let _ = fs::remove_dir_all(&dir);
    }


    #[test]
    fn sidecar_job_identifier_roundtrip() {
        let dir = std::env::temp_dir().join(format!("rustroom_job_{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let photo = dir.join("j.ARW");
        fs::write(&photo, b"raw").unwrap();
        let mut meta = ImageMetadata::default();
        let mut exif = std::collections::HashMap::new();
        exif.insert("JobIdentifier".to_string(), "JOB-2024-042".to_string());
        meta.exif = Some(exif);
        sync_metadata_to_xmp(&photo, &meta, true);
        let written = fs::read_to_string(dir.join("j.xmp")).unwrap();
        assert!(
            written.contains("JOB-2024-042")
                && (written.contains("TransmissionReference") || written.contains("JobIdentifier")),
            "job: {}",
            &written[..written.len().min(700)]
        );
        let mut loaded = ImageMetadata::default();
        assert!(sync_metadata_from_xmp(&photo, &mut loaded));
        let e = loaded.exif.expect("exif");
        let job = e
            .get("JobIdentifier")
            .or_else(|| e.get("JobID"))
            .map(|s| s.as_str())
            .unwrap_or("");
        assert_eq!(job, "JOB-2024-042");
        let _ = fs::remove_dir_all(&dir);
    }


    #[test]
    fn sidecar_digital_source_type_roundtrip() {
        let dir = std::env::temp_dir().join(format!("rustroom_dst_{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let photo = dir.join("d.ARW");
        fs::write(&photo, b"raw").unwrap();
        let mut meta = ImageMetadata::default();
        let mut exif = std::collections::HashMap::new();
        let uri = "http://cv.iptc.org/newscodes/digitalsourcetype/digitalCapture";
        exif.insert("DigitalSourceType".to_string(), uri.to_string());
        meta.exif = Some(exif);
        sync_metadata_to_xmp(&photo, &meta, true);
        let written = fs::read_to_string(dir.join("d.xmp")).unwrap();
        assert!(
            written.contains("DigitalSourceType") && written.contains("digitalCapture"),
            "dst: {}",
            &written[..written.len().min(700)]
        );
        let mut loaded = ImageMetadata::default();
        assert!(sync_metadata_from_xmp(&photo, &mut loaded));
        let e = loaded.exif.expect("exif");
        assert_eq!(
            e.get("DigitalSourceType").map(|s| s.as_str()),
            Some(uri)
        );
        let _ = fs::remove_dir_all(&dir);
    }


    #[test]
    fn sidecar_caption_writer_roundtrip() {
        let dir = std::env::temp_dir().join(format!("rustroom_cw_{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let photo = dir.join("w.ARW");
        fs::write(&photo, b"raw").unwrap();
        let mut meta = ImageMetadata::default();
        let mut exif = std::collections::HashMap::new();
        exif.insert("CaptionWriter".to_string(), "Editor Bob".to_string());
        meta.exif = Some(exif);
        sync_metadata_to_xmp(&photo, &meta, true);
        let written = fs::read_to_string(dir.join("w.xmp")).unwrap();
        assert!(
            written.contains("CaptionWriter") && written.contains("Editor Bob"),
            "cw: {}",
            &written[..written.len().min(700)]
        );
        let mut loaded = ImageMetadata::default();
        assert!(sync_metadata_from_xmp(&photo, &mut loaded));
        let e = loaded.exif.expect("exif");
        assert_eq!(
            e.get("CaptionWriter").map(|s| s.as_str()),
            Some("Editor Bob")
        );
        let _ = fs::remove_dir_all(&dir);
    }


    #[test]
    fn sidecar_category_roundtrip() {
        let dir = std::env::temp_dir().join(format!("rustroom_cat_{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let photo = dir.join("c.ARW");
        fs::write(&photo, b"raw").unwrap();
        let mut meta = ImageMetadata::default();
        let mut exif = std::collections::HashMap::new();
        exif.insert("Category".to_string(), "SPO".to_string());
        exif.insert(
            "SupplementalCategories".to_string(),
            "Football, Night".to_string(),
        );
        meta.exif = Some(exif);
        sync_metadata_to_xmp(&photo, &meta, true);
        let written = fs::read_to_string(dir.join("c.xmp")).unwrap();
        assert!(
            written.contains("Category") && written.contains("SPO"),
            "cat: {}",
            &written[..written.len().min(700)]
        );
        assert!(
            written.contains("SupplementalCategories")
                && written.contains("Football")
                && written.contains("Night"),
            "supp: {}",
            &written[..written.len().min(700)]
        );
        let mut loaded = ImageMetadata::default();
        assert!(sync_metadata_from_xmp(&photo, &mut loaded));
        let e = loaded.exif.expect("exif");
        assert_eq!(e.get("Category").map(|s| s.as_str()), Some("SPO"));
        let supp = e
            .get("SupplementalCategories")
            .map(|s| s.as_str())
            .unwrap_or("");
        assert!(
            supp.contains("Football") && supp.contains("Night"),
            "imported supp: {}",
            supp
        );
        let _ = fs::remove_dir_all(&dir);
    }


    #[test]
    fn sidecar_urgency_roundtrip() {
        let dir = std::env::temp_dir().join(format!("rustroom_urg_{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let photo = dir.join("u.ARW");
        fs::write(&photo, b"raw").unwrap();
        let mut meta = ImageMetadata::default();
        let mut exif = std::collections::HashMap::new();
        exif.insert("Urgency".to_string(), "1".to_string());
        meta.exif = Some(exif);
        sync_metadata_to_xmp(&photo, &meta, true);
        let written = fs::read_to_string(dir.join("u.xmp")).unwrap();
        assert!(
            written.contains("Urgency") && written.contains('1'),
            "urgency: {}",
            &written[..written.len().min(600)]
        );
        let mut loaded = ImageMetadata::default();
        assert!(sync_metadata_from_xmp(&photo, &mut loaded));
        let e = loaded.exif.expect("exif");
        assert_eq!(e.get("Urgency").map(|s| s.as_str()), Some("1"));
        let _ = fs::remove_dir_all(&dir);
    }


    #[test]
    fn sidecar_creator_contact_roundtrip() {
        let dir = std::env::temp_dir().join(format!("rustroom_contact_{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let photo = dir.join("c.ARW");
        fs::write(&photo, b"raw").unwrap();
        let mut meta = ImageMetadata::default();
        let mut exif = std::collections::HashMap::new();
        exif.insert("CiEmailWork".to_string(), "photo@example.com".to_string());
        exif.insert("CiTelWork".to_string(), "+33 1 23 45 67 89".to_string());
        meta.exif = Some(exif);
        sync_metadata_to_xmp(&photo, &meta, true);
        let written = fs::read_to_string(dir.join("c.xmp")).unwrap();
        assert!(
            written.contains("CiEmailWork") && written.contains("photo@example.com"),
            "email: {}",
            &written[..written.len().min(700)]
        );
        assert!(
            written.contains("CiTelWork") && written.contains("+33"),
            "phone: {}",
            &written[..written.len().min(700)]
        );
        let mut loaded = ImageMetadata::default();
        assert!(sync_metadata_from_xmp(&photo, &mut loaded));
        let e = loaded.exif.expect("exif");
        assert_eq!(
            e.get("CiEmailWork").map(|s| s.as_str()),
            Some("photo@example.com")
        );
        assert_eq!(
            e.get("CiTelWork").map(|s| s.as_str()),
            Some("+33 1 23 45 67 89")
        );
        let _ = fs::remove_dir_all(&dir);
    }


    #[test]
    fn sidecar_creator_address_roundtrip() {
        let dir = std::env::temp_dir().join(format!("rustroom_addr_{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let photo = dir.join("a.ARW");
        fs::write(&photo, b"raw").unwrap();
        let mut meta = ImageMetadata::default();
        let mut exif = std::collections::HashMap::new();
        exif.insert("CiAdrExtadr".to_string(), "12 Rue de Rivoli".to_string());
        exif.insert("CiAdrCity".to_string(), "Paris".to_string());
        exif.insert("CiAdrRegion".to_string(), "IDF".to_string());
        exif.insert("CiAdrPcode".to_string(), "75001".to_string());
        exif.insert("CiAdrCtry".to_string(), "France".to_string());
        meta.exif = Some(exif);
        sync_metadata_to_xmp(&photo, &meta, true);
        let written = fs::read_to_string(dir.join("a.xmp")).unwrap();
        assert!(
            written.contains("CiAdrCity") && written.contains("Paris"),
            "addr: {}",
            &written[..written.len().min(800)]
        );
        assert!(
            written.contains("CiAdrExtadr") && written.contains("Rivoli"),
            "street: {}",
            &written[..written.len().min(800)]
        );
        let mut loaded = ImageMetadata::default();
        assert!(sync_metadata_from_xmp(&photo, &mut loaded));
        let e = loaded.exif.expect("exif");
        assert_eq!(e.get("CiAdrCity").map(|s| s.as_str()), Some("Paris"));
        assert_eq!(e.get("CiAdrPcode").map(|s| s.as_str()), Some("75001"));
        assert_eq!(e.get("CiAdrCtry").map(|s| s.as_str()), Some("France"));
        let _ = fs::remove_dir_all(&dir);
    }

#[test]
    fn label_and_rating_sync_to_xmp() {
        use crate::image_processing::ImageMetadata;
        let dir = std::env::temp_dir().join(format!("rr_label_xmp_{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let photo = dir.join("shot.ARW");
        fs::write(&photo, b"fake").unwrap();

        let mut meta = ImageMetadata::default();
        meta.rating = 4;
        meta.tags = Some(vec!["color:red".to_string(), "user:holiday".to_string()]);
        meta.adjustments = serde_json::json!({ "exposure": 0.1 });

        sync_metadata_to_xmp(&photo, &meta, true);
        let xmp_path = resolve_xmp_path(&photo).expect("xmp written");
        let content = fs::read_to_string(&xmp_path).unwrap();
        assert!(
            content.contains("xmp:Rating") || content.contains("<xmp:Rating>"),
            "rating in xmp"
        );
        assert!(
            content.contains("4"),
            "rating value present"
        );
        // Label should be capitalized for LR (Red not red)
        assert!(
            content.contains("xmp:Label") && content.contains("Red"),
            "capitalized label Red: {}",
            &content[..content.len().min(600)]
        );
        assert!(content.contains("holiday"), "keyword preserved");

        // re-import into empty metadata
        let mut meta2 = ImageMetadata::default();
        let changed = sync_metadata_from_xmp(&photo, &mut meta2);
        assert!(changed, "should import rating/label");
        assert_eq!(meta2.rating, 4);
        let tags = meta2.tags.unwrap_or_default();
        assert!(
            tags.iter().any(|t| t == "color:red"),
            "label imported lowercase color tag: {:?}",
            tags
        );

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn extract_xmp_label_reads_attr_and_element() {
        let attr = r#"<rdf:Description xmp:Label="Blue" xmp:Rating="3" />"#;
        assert_eq!(extract_xmp_label(attr).as_deref(), Some("Blue"));
        assert_eq!(extract_xmp_rating(attr), Some(3));
        let elem = r#"<xmp:Label>Green</xmp:Label><xmp:Rating>5</xmp:Rating>"#;
        assert_eq!(extract_xmp_label(elem).as_deref(), Some("Green"));
        assert_eq!(extract_xmp_rating(elem), Some(5));
    }

    #[test]
    fn flag_tag_syncs_to_xmp_keywords() {
        use crate::image_processing::ImageMetadata;
        let dir = std::env::temp_dir().join(format!("rr_flag_xmp_{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let photo = dir.join("flagged.ARW");
        fs::write(&photo, b"fake").unwrap();

        let mut meta = ImageMetadata::default();
        meta.tags = Some(vec!["flag:pick".to_string(), "color:blue".to_string()]);
        sync_metadata_to_xmp(&photo, &meta, true);
        let content = fs::read_to_string(resolve_xmp_path(&photo).unwrap()).unwrap();
        assert!(content.contains("flag:pick") || content.contains("pick"), "flag keyword: {}", &content[..content.len().min(800)]);
        assert!(content.contains("Blue") || content.contains("blue") || content.contains("xmp:Label"), "label present");

        // clear flags
        meta.tags = Some(vec!["color:blue".to_string()]);
        sync_metadata_to_xmp(&photo, &meta, true);
        let content2 = fs::read_to_string(resolve_xmp_path(&photo).unwrap()).unwrap();
        assert!(!content2.contains("flag:pick"), "flag keyword removed");

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn location_fields_sync_to_xmp() {
        let dir = std::env::temp_dir().join(format!("rustroom_loc_{}", std::process::id()));
        let _ = fs::create_dir_all(&dir);
        let img = dir.join("photo.jpg");
        fs::write(&img, b"fake").unwrap();
        let mut meta = ImageMetadata::default();
        let mut exif = std::collections::HashMap::new();
        exif.insert("City".to_string(), "Paris".to_string());
        exif.insert("Country".to_string(), "France".to_string());
        exif.insert("Location".to_string(), "Louvre".to_string());
        exif.insert("State".to_string(), "IDF".to_string());
        exif.insert("Headline".to_string(), "Museum day".to_string());
        meta.exif = Some(exif);
        sync_metadata_to_xmp(&img, &meta, true);
        let xmp = fs::read_to_string(img.with_extension("xmp")).unwrap();
        assert!(xmp.contains("photoshop:City") || xmp.contains("<photoshop:City>Paris</photoshop:City>"), "city: {}", &xmp[..xmp.len().min(500)]);
        assert!(xmp.contains("Paris"), "city value");
        assert!(xmp.contains("France"), "country");
        assert!(xmp.contains("Louvre"), "location");
        assert!(xmp.contains("xmlns:photoshop="), "photoshop ns");
        assert!(xmp.contains("xmlns:Iptc4xmpCore="), "iptc ns");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn hierarchical_subject_sync_to_xmp() {
        let dir = std::env::temp_dir().join(format!("rustroom_hier_{}", std::process::id()));
        let _ = fs::create_dir_all(&dir);
        let img = dir.join("photo.jpg");
        fs::write(&img, b"fake").unwrap();
        let mut meta = ImageMetadata::default();
        meta.tags = Some(vec![
            "user:travel".to_string(),
            "user:travel/paris".to_string(),
            "user:food".to_string(),
        ]);
        sync_metadata_to_xmp(&img, &meta, true);
        let xmp = fs::read_to_string(img.with_extension("xmp")).unwrap();
        assert!(xmp.contains("dc:subject"), "subject: {}", &xmp[..xmp.len().min(400)]);
        assert!(xmp.contains("paris") || xmp.contains("travel"), "leaf keywords");
        assert!(
            xmp.contains("hierarchicalSubject") && xmp.contains("travel|paris"),
            "hierarchical: {}",
            &xmp[..xmp.len().min(800)]
        );
        assert!(xmp.contains("xmlns:lr="), "lr ns");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn hierarchical_subject_import_from_xmp() {
        let xmp = r#"<?xml version="1.0" encoding="UTF-8"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
    xmlns:dc="http://purl.org/dc/elements/1.1/"
    xmlns:lr="http://ns.adobe.com/lightroom/1.0/">
   <dc:subject>
    <rdf:Bag>
     <rdf:li>paris</rdf:li>
     <rdf:li>food</rdf:li>
     <rdf:li>flag:pick</rdf:li>
    </rdf:Bag>
   </dc:subject>
   <lr:hierarchicalSubject>
    <rdf:Bag>
     <rdf:li>travel|paris</rdf:li>
    </rdf:Bag>
   </lr:hierarchicalSubject>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>"#;
        let tags = extract_xmp_tags(xmp);
        assert!(tags.iter().any(|t| t == "user:paris"), "leaf paris: {:?}", tags);
        assert!(tags.iter().any(|t| t == "user:food"), "food: {:?}", tags);
        assert!(tags.iter().any(|t| t == "user:travel"), "parent travel: {:?}", tags);
        assert!(
            tags.iter().any(|t| t == "user:travel/paris"),
            "hier path: {:?}",
            tags
        );
        assert!(tags.iter().any(|t| t == "flag:pick"), "flag preserved: {:?}", tags);
    }

    #[test]
    fn relative_adjustments_merge_math() {
        // Mirrors apply_relative_adjustments_to_paths numeric merge (without AppHandle).
        let mut map = serde_json::Map::new();
        map.insert("exposure".to_string(), serde_json::json!(0.5));
        map.insert("contrast".to_string(), serde_json::json!(10.0));
        let deltas = serde_json::json!({ "exposure": 0.33, "contrast": -10.0, "shadows": 15.0 });
        let delta_map = deltas.as_object().unwrap();
        for (k, v) in delta_map {
            let delta = v.as_f64().unwrap_or(0.0);
            let current = map.get(k).and_then(|x| x.as_f64()).unwrap_or(0.0);
            map.insert(k.clone(), serde_json::json!(current + delta));
        }
        assert!((map["exposure"].as_f64().unwrap() - 0.83).abs() < 1e-9);
        assert!((map["contrast"].as_f64().unwrap() - 0.0).abs() < 1e-9);
        assert!((map["shadows"].as_f64().unwrap() - 15.0).abs() < 1e-9);
    }

    #[test]
    fn write_text_file_writes_utf8() {
        let dir = std::env::temp_dir().join(format!("rr_write_text_{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("gallery.html");
        let body = "<!DOCTYPE html><html><body>ok</body></html>";
        write_text_file(path.to_string_lossy().to_string(), body.to_string()).unwrap();
        let read = fs::read_to_string(&path).unwrap();
        assert_eq!(read, body);
        // nested create
        let nested = dir.join("sub").join("page.html");
        write_text_file(nested.to_string_lossy().to_string(), "hi".to_string()).unwrap();
        assert_eq!(fs::read_to_string(&nested).unwrap(), "hi");
        let _ = fs::remove_dir_all(&dir);
    }






}

/// Test-only access points for `crate::perf_bench`. Not compiled into the app.
#[cfg(test)]
pub(crate) mod bench_hooks {
    use super::*;

    /// Handle-free copy of `list_images_in_dir` (same logic, minus
    /// `update_rotational_disk_flag` and the iCloud `enqueue_metadata` branch,
    /// which need an AppHandle and are no-ops for local files).
    pub(crate) fn list_images_in_dir_no_handle(
        path: &str,
        settings: &AppSettings,
    ) -> std::result::Result<Vec<ImageFile>, String> {
        let enable_xmp_sync = settings.enable_xmp_sync.unwrap_or(false);
        let entries = fs::read_dir(path).map_err(|e| e.to_string())?;
        let mut images = Vec::new();
        let mut sidecars_by_filename: HashMap<String, Vec<Option<String>>> = HashMap::new();

        for entry in entries.filter_map(std::result::Result::ok) {
            let entry_path = entry.path();
            let file_name = entry
                .file_name()
                .into_string()
                .unwrap_or_else(|os| os.to_string_lossy().into_owned());

            if file_name.ends_with(".rrdata") {
                let base = &file_name[..file_name.len() - 7];
                let (source_filename, copy_id) =
                    if base.len() >= 7 && base.as_bytes()[base.len() - 7] == b'.' {
                        let id = &base[base.len() - 6..];
                        if id.chars().all(|c| matches!(c, '0'..='9' | 'a'..='f')) {
                            (&base[..base.len() - 7], Some(id.to_string()))
                        } else {
                            (base, None)
                        }
                    } else {
                        (base, None)
                    };
                sidecars_by_filename
                    .entry(source_filename.to_string())
                    .or_default()
                    .push(copy_id);
            } else if is_supported_image_file(&file_name) {
                images.push((file_name, entry_path));
            }
        }

        let tasks: Vec<_> = images
            .into_iter()
            .map(|(file_name, path_buf)| {
                let sidecars = sidecars_by_filename
                    .remove(&file_name)
                    .unwrap_or_else(|| vec![None]);
                let path_str = path_buf.to_string_lossy().into_owned();
                (path_str, file_name, path_buf, sidecars)
            })
            .collect();

        let mut result_list: Vec<ImageFile> = tasks
            .into_par_iter()
            .flat_map(|(path_str, file_name, path_buf, sidecars)| {
                let modified = fs::metadata(&path_buf)
                    .ok()
                    .and_then(|m| m.modified().ok())
                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|d| d.as_secs())
                    .unwrap_or(0);
                let is_cloud_placeholder = is_cloud_placeholder(&path_buf);
                let mut file_results = Vec::with_capacity(sidecars.len());
                for copy_id_opt in sidecars {
                    let (virtual_path, is_virtual_copy, sidecar_filename) = match copy_id_opt {
                        Some(id) => (
                            format!("{}?vc={}", path_str, id),
                            true,
                            format!("{}.{}.rrdata", file_name, id),
                        ),
                        None => (path_str.clone(), false, format!("{}.rrdata", file_name)),
                    };
                    let sidecar_path = path_buf.with_file_name(sidecar_filename);
                    let _xmp_is_placeholder = enable_xmp_sync
                        && resolve_xmp_path(&path_buf).is_some_and(|p| super::is_cloud_placeholder(&p));
                    let _sidecar_placeholder = super::is_cloud_placeholder(&sidecar_path);
                    let metadata =
                        resolve_image_metadata(&path_buf, &sidecar_path, enable_xmp_sync, settings);
                    file_results.push(ImageFile {
                        path: virtual_path,
                        modified,
                        is_edited: metadata.is_edited,
                        tags: metadata.tags,
                        exif: None,
                        is_virtual_copy,
                        is_raw: metadata.is_raw,
                        group_id: None,
                        rating: metadata.rating,
                        is_cloud_placeholder,
                    });
                }
                file_results
            })
            .collect();

        assign_group_ids(&mut result_list, settings);
        Ok(result_list)
    }

    pub(crate) fn try_load_embedded_raw_preview(
        source_path: &Path,
        target_res: u32,
    ) -> Option<DynamicImage> {
        super::try_load_embedded_raw_preview(source_path, target_res)
    }

    pub(crate) fn encode_thumbnail(image: &DynamicImage, target_width: u32) -> Result<Vec<u8>> {
        super::encode_thumbnail(image, target_width)
    }

    pub(crate) fn compute_thumbnail_cache_hash(
        path_str: &str,
        adjustments_bytes: &[u8],
    ) -> Option<String> {
        super::compute_thumbnail_cache_hash(path_str, adjustments_bytes)
    }
}
