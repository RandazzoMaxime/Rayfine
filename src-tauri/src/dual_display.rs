use serde::Serialize;
use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

use crate::AppState;

pub const DISPLAY_WINDOW_LABEL: &str = "display";

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MonitorInfo {
    pub id: String,
    pub name: String,
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub is_os_primary: bool,
}

pub fn dual_display_can_enable(monitors: &[MonitorInfo]) -> bool {
    monitors.len() >= 2
}

pub fn pick_ui_monitor<'a>(
    monitors: &'a [MonitorInfo],
    principal_id: &str,
) -> Option<&'a MonitorInfo> {
    monitors
        .iter()
        .find(|m| m.id != principal_id)
        .or_else(|| monitors.first())
}

pub fn pick_principal<'a>(
    monitors: &'a [MonitorInfo],
    preferred_id: &str,
) -> Option<&'a MonitorInfo> {
    monitors
        .iter()
        .find(|m| m.id == preferred_id)
        .or_else(|| monitors.iter().find(|m| m.is_os_primary))
        .or_else(|| monitors.first())
}

#[cfg(not(target_os = "android"))]
pub fn list_monitor_info(app: &tauri::AppHandle) -> Vec<MonitorInfo> {
    let window = app
        .get_webview_window("main")
        .or_else(|| app.webview_windows().into_values().next());
    let Some(window) = window else {
        return Vec::new();
    };
    let primary_name = window
        .primary_monitor()
        .ok()
        .flatten()
        .and_then(|m| m.name().map(|s| s.to_string()));
    window
        .available_monitors()
        .map(|monitors| {
            monitors
                .into_iter()
                .enumerate()
                .map(|(i, monitor)| {
                    let position = monitor.position();
                    let size = monitor.size();
                    let raw_name = monitor.name().map(|s| s.to_string()).unwrap_or_default();
                    let is_os_primary = primary_name
                        .as_ref()
                        .map(|p| p == &raw_name)
                        .unwrap_or(i == 0);
                    let name = if raw_name.trim().is_empty() {
                        format!("Écran {} ({}×{})", i + 1, size.width, size.height)
                    } else {
                        format!("{} ({}×{})", raw_name, size.width, size.height)
                    };
                    MonitorInfo {
                        id: i.to_string(),
                        name,
                        x: position.x,
                        y: position.y,
                        width: size.width,
                        height: size.height,
                        is_os_primary,
                    }
                })
                .collect()
        })
        .unwrap_or_default()
}

#[cfg(target_os = "android")]
pub fn list_monitor_info(_app: &tauri::AppHandle) -> Vec<MonitorInfo> {
    Vec::new()
}

#[tauri::command]
pub fn list_monitors(app_handle: tauri::AppHandle) -> Vec<MonitorInfo> {
    list_monitor_info(&app_handle)
}

#[tauri::command]
pub fn get_dual_display_state(
    app_handle: tauri::AppHandle,
    state: tauri::State<AppState>,
) -> serde_json::Value {
    let enabled = state.dual_display_enabled.load(std::sync::atomic::Ordering::Relaxed);
    let principal_id = state.dual_display_principal_id.lock().unwrap().clone();
    serde_json::json!({
        "enabled": enabled,
        "principalId": principal_id,
        "monitors": list_monitor_info(&app_handle),
    })
}

#[tauri::command]
pub fn set_dual_display(
    enabled: bool,
    principal_id: Option<String>,
    app_handle: tauri::AppHandle,
    state: tauri::State<AppState>,
) -> Result<serde_json::Value, String> {
    apply_dual_display(&app_handle, &state, enabled, principal_id)
}

pub fn apply_dual_display(
    app: &tauri::AppHandle,
    state: &AppState,
    enabled: bool,
    principal_id: Option<String>,
) -> Result<serde_json::Value, String> {
    let monitors = list_monitor_info(app);
    if enabled && !dual_display_can_enable(&monitors) {
        let payload = serde_json::json!({
            "enabled": false,
            "principalId": principal_id.unwrap_or_default(),
            "monitors": monitors,
            "error": "Deux écrans sont nécessaires pour le double affichage.",
        });
        let _ = app.emit("dual-display-changed", payload.clone());
        return Err("Deux écrans sont nécessaires pour le double affichage.".into());
    }

    if let Some(id) = principal_id {
        *state.dual_display_principal_id.lock().unwrap() = id;
    }

    let principal_id = state.dual_display_principal_id.lock().unwrap().clone();
    let principal = pick_principal(&monitors, &principal_id);
    if let Some(p) = principal {
        *state.dual_display_principal_id.lock().unwrap() = p.id.clone();
    }
    let principal_id = state.dual_display_principal_id.lock().unwrap().clone();

    if enabled {
        let principal = pick_principal(&monitors, &principal_id)
            .ok_or_else(|| "Aucun écran disponible.".to_string())?;
        let ui = pick_ui_monitor(&monitors, &principal.id)
            .ok_or_else(|| "Aucun écran d'interface disponible.".to_string())?;
        open_display_window(app, principal)?;
        place_main_window(app, ui)?;
        #[cfg(not(any(target_os = "android", target_os = "linux")))]
        {
            let _ = crate::gpu_processing::reattach_gpu_display(state, app, DISPLAY_WINDOW_LABEL);
            let _ = crate::gpu_processing::fit_gpu_display_to_window(state, app, DISPLAY_WINDOW_LABEL);
        }
        state
            .dual_display_enabled
            .store(true, std::sync::atomic::Ordering::Relaxed);
    } else {
        close_display_window(app);
        #[cfg(not(any(target_os = "android", target_os = "linux")))]
        {
            let _ = crate::gpu_processing::reattach_gpu_display(state, app, "main");
        }
        state
            .dual_display_enabled
            .store(false, std::sync::atomic::Ordering::Relaxed);
        if let Some(main) = app.get_webview_window("main") {
            let _ = main.set_focus();
        }
    }

    let _ = rebuild_native_menu(app, state);
    let payload = serde_json::json!({
        "enabled": state.dual_display_enabled.load(std::sync::atomic::Ordering::Relaxed),
        "principalId": state.dual_display_principal_id.lock().unwrap().clone(),
        "monitors": monitors,
    });
    let _ = app.emit("dual-display-changed", payload.clone());
    Ok(payload)
}

fn open_display_window(app: &tauri::AppHandle, principal: &MonitorInfo) -> Result<(), String> {
    if let Some(existing) = app.get_webview_window(DISPLAY_WINDOW_LABEL) {
        position_window(&existing, principal)?;
        let _ = existing.set_fullscreen(true);
        let _ = existing.show();
        return Ok(());
    }

    let window = WebviewWindowBuilder::new(app, DISPLAY_WINDOW_LABEL, WebviewUrl::App("index.html".into()))
        .title("Rayfine — Affichage")
        .decorations(false)
        .transparent(true)
        .visible(true)
        .skip_taskbar(false)
        .initialization_script("window.__RAYFINE_WINDOW_ROLE='display';")
        .build()
        .map_err(|e| format!("Impossible d'ouvrir la fenêtre d'affichage: {e}"))?;

    position_window(&window, principal)?;
    let _ = window.set_fullscreen(true);
    let _ = window.show();
    let app_for_resize = app.clone();
    let _ = window.on_window_event(move |event| {
        if matches!(event, tauri::WindowEvent::Resized(_)) {
            let state = app_for_resize.state::<AppState>();
            #[cfg(not(any(target_os = "android", target_os = "linux")))]
            {
                let _ = crate::gpu_processing::fit_gpu_display_to_window(
                    &state,
                    &app_for_resize,
                    DISPLAY_WINDOW_LABEL,
                );
            }
            #[cfg(any(target_os = "android", target_os = "linux"))]
            let _ = &state;
        }
    });
    Ok(())
}

fn close_display_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window(DISPLAY_WINDOW_LABEL) {
        let _ = window.set_fullscreen(false);
        let _ = window.close();
    }
}

fn position_window(window: &tauri::WebviewWindow, monitor: &MonitorInfo) -> Result<(), String> {
    let _ = window.set_fullscreen(false);
    window
        .set_position(tauri::Position::Physical(tauri::PhysicalPosition::new(
            monitor.x,
            monitor.y,
        )))
        .map_err(|e| e.to_string())?;
    window
        .set_size(tauri::Size::Physical(tauri::PhysicalSize::new(
            monitor.width,
            monitor.height,
        )))
        .map_err(|e| e.to_string())?;
    Ok(())
}

fn place_main_window(app: &tauri::AppHandle, ui: &MonitorInfo) -> Result<(), String> {
    let main = app
        .get_webview_window("main")
        .ok_or_else(|| "Fenêtre principale introuvable.".to_string())?;
    let _ = main.set_fullscreen(false);
    position_window(&main, ui)?;
    let _ = main.maximize();
    let _ = main.show();
    Ok(())
}

pub fn rebuild_native_menu(app: &tauri::AppHandle, state: &AppState) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        let _ = (app, state);
        return Ok(());
    }
    #[cfg(not(target_os = "android"))]
    {
        use tauri::menu::{CheckMenuItem, MenuBuilder, MenuItem, SubmenuBuilder};

        let export_item = MenuItem::with_id(app, "file_export", "Exporter…", true, Some("CmdOrCtrl+Shift+E"))
            .map_err(|e| e.to_string())?;
        let import_lr_item = MenuItem::with_id(
            app,
            "file_import_lrcat",
            "Importer un catalogue Lightroom…",
            true,
            None::<&str>,
        )
        .map_err(|e| e.to_string())?;
        let file_menu = SubmenuBuilder::new(app, "Fichier")
            .item(&import_lr_item)
            .separator()
            .item(&export_item)
            .build()
            .map_err(|e| e.to_string())?;

        let enabled = state.dual_display_enabled.load(std::sync::atomic::Ordering::Relaxed);
        let principal_id = state.dual_display_principal_id.lock().unwrap().clone();
        let monitors = list_monitor_info(app);
        let dual_item = CheckMenuItem::with_id(
            app,
            "view_dual_screen",
            "Double écran",
            dual_display_can_enable(&monitors),
            enabled,
            None::<&str>,
        )
        .map_err(|e| e.to_string())?;

        let mut principal_menu = SubmenuBuilder::new(app, "Écran principal");
        if monitors.is_empty() {
            let empty = MenuItem::with_id(app, "view_monitor_none", "Aucun écran", false, None::<&str>)
                .map_err(|e| e.to_string())?;
            principal_menu = principal_menu.item(&empty);
        } else {
            for monitor in &monitors {
                let item = CheckMenuItem::with_id(
                    app,
                    format!("view_monitor_{}", monitor.id),
                    &monitor.name,
                    true,
                    monitor.id == principal_id || (principal_id.is_empty() && monitor.is_os_primary),
                    None::<&str>,
                )
                .map_err(|e| e.to_string())?;
                principal_menu = principal_menu.item(&item);
            }
        }
        let principal_menu = principal_menu.build().map_err(|e| e.to_string())?;

        let view_menu = SubmenuBuilder::new(app, "Affichage")
            .item(&dual_item)
            .separator()
            .item(&principal_menu)
            .build()
            .map_err(|e| e.to_string())?;

        let menu = MenuBuilder::new(app)
            .item(&file_menu)
            .item(&view_menu)
            .build()
            .map_err(|e| e.to_string())?;

        if let Some(main) = app.get_webview_window("main") {
            let _ = main.set_menu(menu);
        }
        Ok(())
    }
}

pub fn handle_menu_event(app: &tauri::AppHandle, id: &str) {
    match id {
        "file_export" => {
            let _ = app.emit("menu-export", ());
        }
        "file_import_lrcat" => {
            let _ = app.emit("menu-import-lrcat", ());
        }
        "view_dual_screen" => {
            let state = app.state::<AppState>();
            let next = !state.dual_display_enabled.load(std::sync::atomic::Ordering::Relaxed);
            if let Err(e) = apply_dual_display(app, &state, next, None) {
                let _ = app.emit("dual-display-error", e);
            }
        }
        id if id.starts_with("view_monitor_") => {
            let monitor_id = id.trim_start_matches("view_monitor_").to_string();
            let state = app.state::<AppState>();
            *state.dual_display_principal_id.lock().unwrap() = monitor_id.clone();
            let enabled = state.dual_display_enabled.load(std::sync::atomic::Ordering::Relaxed);
            if enabled {
                if let Err(e) = apply_dual_display(app, &state, true, Some(monitor_id)) {
                    let _ = app.emit("dual-display-error", e);
                }
            } else {
                let _ = rebuild_native_menu(app, &state);
                let payload = serde_json::json!({
                    "enabled": false,
                    "principalId": state.dual_display_principal_id.lock().unwrap().clone(),
                    "monitors": list_monitor_info(app),
                });
                let _ = app.emit("dual-display-changed", payload);
            }
        }
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mon(id: &str, primary: bool) -> MonitorInfo {
        MonitorInfo {
            id: id.into(),
            name: format!("Écran {id}"),
            x: if id == "0" { 0 } else { 1920 },
            y: 0,
            width: 1920,
            height: 1080,
            is_os_primary: primary,
        }
    }

    #[test]
    fn dual_needs_two_monitors() {
        assert!(!dual_display_can_enable(&[mon("0", true)]));
        assert!(dual_display_can_enable(&[mon("0", true), mon("1", false)]));
    }

    #[test]
    fn ui_monitor_is_the_other_one() {
        let monitors = vec![mon("0", true), mon("1", false)];
        let ui = pick_ui_monitor(&monitors, "0").expect("ui");
        assert_eq!(ui.id, "1");
        let principal = pick_principal(&monitors, "1").expect("p");
        assert_eq!(principal.id, "1");
        let fallback = pick_principal(&monitors, "missing").expect("os primary");
        assert_eq!(fallback.id, "0");
    }
}
