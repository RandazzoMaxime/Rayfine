//! Library opens first. Develop is the other workspace. Nothing else is a tab.

use std::time::Duration;

use serde_json::json;

use crate::headless::Headless;
use crate::state::{AppModule, ViewMode};
use crate::{LightcraftApp, Services};

const T: Duration = Duration::from_secs(20);

fn app() -> Headless {
    let services = Services { png: None, ..Default::default() };
    Headless::new(LightcraftApp::new(lightcraft_engine::Session::with_demo(), services), [1280.0, 800.0], 1.0)
}

#[test]
fn library_is_the_opening_workspace_and_detail_is_develop() {
    let mut h = app();
    h.app.ui.show_library();
    assert_eq!((h.app.ui.module, h.app.ui.view), (AppModule::Library, ViewMode::PhotoGrid));
    assert!(h.app.ui.left_panel);
    assert_eq!(h.app.ui.right, crate::state::RightPanel::None);

    let r = h.request("engine.execute", json!({"command": "view.detail"}), T);
    assert_eq!(r["ok"], true, "{r}");
    assert_eq!((h.app.ui.module, h.app.ui.view), (AppModule::Develop, ViewMode::Detail));
    assert_eq!(h.app.ui.right, crate::state::RightPanel::Edit);

    let r = h.request("engine.execute", json!({"command": "view.library"}), T);
    assert_eq!(r["ok"], true, "{r}");
    assert_eq!((h.app.ui.module, h.app.ui.view), (AppModule::Library, ViewMode::PhotoGrid));
}

#[test]
fn the_module_bar_offers_only_library_and_develop() {
    let mut h = app();
    h.app.ui.show_library();
    h.step();
    h.step();
    let ids: Vec<&str> = h.app.widgets.iter().map(|(id, _)| id.as_str()).collect();
    assert!(ids.contains(&"tab:library"), "{ids:?}");
    assert!(ids.contains(&"tab:develop"), "{ids:?}");
    assert!(!ids.iter().any(|id| matches!(*id, "tab:web" | "tab:print" | "tab:map" | "tab:book" | "tab:slideshow")));
    let r = h.request("ui.clickWidget", json!({"id": "tab:develop"}), T);
    assert_eq!(r["ok"], true, "{r}");
    h.step();
    assert_eq!(h.app.ui.module, AppModule::Develop);
}
