//! Import Adobe Lightroom Classic catalogs (`.lrcat` = SQLite) into the RustROOM catalog.

use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

use rusqlite::{Connection, OpenFlags};
use serde::Serialize;
use tauri::AppHandle;
use uuid::Uuid;

use crate::catalog::{self, PhotoMeta};
use crate::file_management::{self, AlbumItem};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LrcatImportResult {
    pub collections: usize,
    pub photos: usize,
    pub missing: usize,
}

fn open_readonly_copy(src: &Path) -> Result<(Connection, PathBuf), String> {
    let tmp = std::env::temp_dir().join(format!("rustroom-lrcat-{}.sqlite", Uuid::new_v4()));
    fs::copy(src, &tmp).map_err(|e| format!("cannot read Lightroom catalog (is it open?): {e}"))?;
    // Sidecar wal/shm are ignored — we copied a snapshot.
    let conn = Connection::open_with_flags(
        &tmp,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_URI,
    )
    .map_err(|e| e.to_string())?;
    Ok((conn, tmp))
}

fn table_exists(conn: &Connection, name: &str) -> bool {
    conn.query_row(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?1",
        [name],
        |_| Ok(()),
    )
    .is_ok()
}

fn column_exists(conn: &Connection, table: &str, col: &str) -> bool {
    let mut stmt = match conn.prepare(&format!("PRAGMA table_info({table})")) {
        Ok(s) => s,
        Err(_) => return false,
    };
    let rows = stmt.query_map([], |row| row.get::<_, String>(1));
    match rows {
        Ok(iter) => iter.filter_map(|r| r.ok()).any(|n| n == col),
        Err(_) => false,
    }
}

fn map_color(label: &str) -> String {
    match label.trim().to_ascii_lowercase().as_str() {
        "red" => "red".into(),
        "yellow" => "yellow".into(),
        "green" => "green".into(),
        "blue" => "blue".into(),
        "purple" | "violet" => "purple".into(),
        _ => String::new(),
    }
}

fn native_path(root: &str, folder: &str, file: &str) -> String {
    let mut parts = String::new();
    let push = |buf: &mut String, seg: &str| {
        let s = seg.replace('\\', "/").trim_matches('/').to_string();
        if s.is_empty() {
            return;
        }
        if !buf.is_empty() && !buf.ends_with('/') {
            buf.push('/');
        }
        buf.push_str(&s);
    };
    push(&mut parts, root);
    push(&mut parts, folder);
    if !parts.is_empty() && !parts.ends_with('/') {
        parts.push('/');
    }
    parts.push_str(file);
    if cfg!(windows) {
        parts.replace('/', "\\")
    } else {
        parts
    }
}

struct LrCollection {
    id: i64,
    name: String,
    parent: Option<i64>,
}

#[tauri::command]
pub fn import_lightroom_catalog(path: String, app: AppHandle) -> Result<LrcatImportResult, String> {
    import_lrcat(path, app)
}

fn import_lrcat(path: String, app: AppHandle) -> Result<LrcatImportResult, String> {
    let src = PathBuf::from(&path);
    if !src.exists() {
        return Err("catalog file not found".into());
    }
    let (conn, tmp) = open_readonly_copy(&src)?;
    let result = import_open(&conn, &app);
    drop(conn);
    let _ = fs::remove_file(tmp);
    result
}

fn import_open(conn: &Connection, app: &AppHandle) -> Result<LrcatImportResult, String> {
    if !table_exists(conn, "AgLibraryFile") || !table_exists(conn, "Adobe_images") {
        return Err("this file is not a Lightroom Classic catalog".into());
    }

    let mut roots: HashMap<i64, String> = HashMap::new();
    if table_exists(conn, "AgLibraryRootFolder") {
        let mut stmt = conn
            .prepare("SELECT id_local, absolutePath FROM AgLibraryRootFolder")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?)))
            .map_err(|e| e.to_string())?;
        for r in rows.flatten() {
            roots.insert(r.0, r.1);
        }
    }

    let mut folders: HashMap<i64, (i64, String)> = HashMap::new();
    if table_exists(conn, "AgLibraryFolder") {
        let mut stmt = conn
            .prepare("SELECT id_local, rootFolder, pathFromRoot FROM AgLibraryFolder")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, String>(2).unwrap_or_default(),
                ))
            })
            .map_err(|e| e.to_string())?;
        for r in rows.flatten() {
            folders.insert(r.0, (r.1, r.2));
        }
    }

    let mut files: HashMap<i64, (i64, String)> = HashMap::new();
    {
        let mut stmt = conn
            .prepare("SELECT id_local, folder, originalFilename FROM AgLibraryFile")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, String>(2).unwrap_or_default(),
                ))
            })
            .map_err(|e| e.to_string())?;
        for r in rows.flatten() {
            files.insert(r.0, (r.1, r.2));
        }
    }

    let has_color = column_exists(conn, "Adobe_images", "colorLabels");
    let has_pick = column_exists(conn, "Adobe_images", "pick");
    let sql = format!(
        "SELECT id_local, rootFile, COALESCE(rating, 0){}{} FROM Adobe_images",
        if has_color {
            ", COALESCE(colorLabels, '')"
        } else {
            ", ''"
        },
        if has_pick { ", COALESCE(pick, 0)" } else { ", 0" }
    );

    let mut image_path: HashMap<i64, String> = HashMap::new();
    let mut photo_meta: HashMap<String, PhotoMeta> = HashMap::new();
    let mut missing = 0usize;
    {
        let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, f64>(2).unwrap_or(0.0),
                    row.get::<_, String>(3).unwrap_or_default(),
                    row.get::<_, i64>(4).unwrap_or(0),
                ))
            })
            .map_err(|e| e.to_string())?;
        for row in rows.flatten() {
            let (image_id, file_id, rating, color, pick) = row;
            let Some((folder_id, filename)) = files.get(&file_id) else {
                continue;
            };
            let Some((root_id, path_from_root)) = folders.get(folder_id) else {
                continue;
            };
            let root = roots.get(root_id).map(String::as_str).unwrap_or("");
            let path = native_path(root, path_from_root, filename);
            if !Path::new(&path).exists() {
                missing += 1;
            }
            let meta = PhotoMeta {
                rating: rating.clamp(0.0, 5.0) as u8,
                color: map_color(&color),
                pick: pick.clamp(-1, 1) as i8,
            };
            if meta.rating != 0 || !meta.color.is_empty() || meta.pick != 0 {
                photo_meta.insert(path.clone(), meta);
            }
            image_path.insert(image_id, path);
        }
    }

    let mut collections: Vec<LrCollection> = Vec::new();
    let mut system_ids: HashSet<i64> = HashSet::new();
    if table_exists(conn, "AgLibraryCollection") {
        let has_system = column_exists(conn, "AgLibraryCollection", "systemOnly");
        let has_parent = column_exists(conn, "AgLibraryCollection", "parent");
        let sql = format!(
            "SELECT id_local, name{}{} FROM AgLibraryCollection",
            if has_parent { ", parent" } else { ", NULL" },
            if has_system {
                ", COALESCE(systemOnly, 0)"
            } else {
                ", 0"
            }
        );
        let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1).unwrap_or_default(),
                    row.get::<_, Option<i64>>(2)?,
                    row.get::<_, i64>(3).unwrap_or(0),
                ))
            })
            .map_err(|e| e.to_string())?;
        for (id, name, parent, system) in rows.flatten() {
            if system != 0 {
                system_ids.insert(id);
                continue;
            }
            let lname = name.to_ascii_lowercase();
            if lname == "quick collection"
                || lname == "all photographs"
                || lname.starts_with("$$")
            {
                system_ids.insert(id);
                continue;
            }
            collections.push(LrCollection { id, name, parent });
        }
    }

    let mut members: HashMap<i64, Vec<String>> = HashMap::new();
    if table_exists(conn, "AgLibraryCollectionImage") {
        let mut stmt = conn
            .prepare("SELECT collection, image FROM AgLibraryCollectionImage")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)))
            .map_err(|e| e.to_string())?;
        for (col_id, image_id) in rows.flatten() {
            if system_ids.contains(&col_id) {
                continue;
            }
            if let Some(path) = image_path.get(&image_id) {
                members.entry(col_id).or_default().push(path.clone());
            }
        }
    }

    let by_parent: HashMap<Option<i64>, Vec<&LrCollection>> = {
        let mut m: HashMap<Option<i64>, Vec<&LrCollection>> = HashMap::new();
        for c in &collections {
            m.entry(c.parent).or_default().push(c);
        }
        m
    };

    fn build_nodes(
        parent: Option<i64>,
        by_parent: &HashMap<Option<i64>, Vec<&LrCollection>>,
        members: &HashMap<i64, Vec<String>>,
    ) -> Vec<AlbumItem> {
        let Some(list) = by_parent.get(&parent) else {
            return Vec::new();
        };
        list.iter()
            .map(|c| {
                let kids = build_nodes(Some(c.id), by_parent, members);
                let images = members.get(&c.id).cloned().unwrap_or_default();
                if !kids.is_empty() && images.is_empty() {
                    AlbumItem::Group {
                        id: format!("lr-{}", c.id),
                        name: c.name.clone(),
                        icon: None,
                        children: kids,
                    }
                } else if !kids.is_empty() {
                    let mut children = kids;
                    children.insert(
                        0,
                        AlbumItem::Album {
                            id: format!("lr-{}", c.id),
                            name: c.name.clone(),
                            icon: None,
                            images,
                        },
                    );
                    AlbumItem::Group {
                        id: format!("lr-set-{}", c.id),
                        name: c.name.clone(),
                        icon: None,
                        children,
                    }
                } else {
                    AlbumItem::Album {
                        id: format!("lr-{}", c.id),
                        name: c.name.clone(),
                        icon: None,
                        images,
                    }
                }
            })
            .collect()
    }

    let mut imported_tree = build_nodes(None, &by_parent, &members);
    for c in &collections {
        if let Some(p) = c.parent {
            if system_ids.contains(&p) {
                let extra = build_nodes(Some(p), &by_parent, &members);
                imported_tree.extend(extra);
                break;
            }
        }
    }

    let in_collection: HashSet<&str> = members
        .values()
        .flatten()
        .map(String::as_str)
        .collect();
    let uncategorized: Vec<String> = image_path
        .values()
        .filter(|p| !in_collection.contains(p.as_str()))
        .cloned()
        .collect();
    if !uncategorized.is_empty() {
        imported_tree.push(AlbumItem::Album {
            id: "uncategorized".into(),
            name: "Sans collection".into(),
            icon: None,
            images: uncategorized,
        });
    }

    let collection_count = count_albums(&imported_tree);
    let photo_count = image_path.len();

    let mut existing = file_management::get_albums(app.clone()).unwrap_or_default();
    existing.retain(|item| match item {
        AlbumItem::Group { id, .. } | AlbumItem::Album { id, .. } => {
            !id.starts_with("lr-") && id != "uncategorized"
        }
    });
    let mut merged = vec![AlbumItem::Group {
        id: "lr-import".into(),
        name: "Lightroom".into(),
        icon: None,
        children: imported_tree,
    }];
    merged.append(&mut existing);

    file_management::save_albums(merged, app.clone())?;
    catalog::upsert_photos(app, photo_meta)?;

    Ok(LrcatImportResult {
        collections: collection_count,
        photos: photo_count,
        missing,
    })
}

fn count_albums(items: &[AlbumItem]) -> usize {
    items
        .iter()
        .map(|i| match i {
            AlbumItem::Album { .. } => 1,
            AlbumItem::Group { children, .. } => count_albums(children),
        })
        .sum()
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    #[test]
    fn maps_paths_and_colors() {
        assert_eq!(map_color("Red"), "red");
        let p = native_path("C:/Photos", "2024/", "DSC.ARW");
        assert!(p.contains("DSC.ARW"));
    }

    #[test]
    fn reads_minimal_sqlite_schema() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            r#"
            CREATE TABLE AgLibraryRootFolder (id_local INTEGER, absolutePath TEXT);
            CREATE TABLE AgLibraryFolder (id_local INTEGER, rootFolder INTEGER, pathFromRoot TEXT);
            CREATE TABLE AgLibraryFile (id_local INTEGER, folder INTEGER, originalFilename TEXT);
            CREATE TABLE Adobe_images (id_local INTEGER, rootFile INTEGER, rating REAL, colorLabels TEXT, pick INTEGER);
            CREATE TABLE AgLibraryCollection (id_local INTEGER, name TEXT, parent INTEGER, systemOnly INTEGER);
            CREATE TABLE AgLibraryCollectionImage (collection INTEGER, image INTEGER);
            INSERT INTO AgLibraryRootFolder VALUES (1, 'C:/Photos');
            INSERT INTO AgLibraryFolder VALUES (1, 1, 'Trip/');
            INSERT INTO AgLibraryFile VALUES (1, 1, 'a.ARW');
            INSERT INTO Adobe_images VALUES (1, 1, 5, 'Red', 1);
            INSERT INTO AgLibraryCollection VALUES (10, 'Best', NULL, 0);
            INSERT INTO AgLibraryCollectionImage VALUES (10, 1);
            "#,
        )
        .unwrap();
        assert!(table_exists(&conn, "Adobe_images"));
        assert!(column_exists(&conn, "Adobe_images", "colorLabels"));
    }
}
