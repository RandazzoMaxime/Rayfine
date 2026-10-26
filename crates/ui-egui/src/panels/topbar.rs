//! The top bar: sidebar toggle, back/forward, and the right-hand icons.

use egui::{Align2, Rect, Sense, pos2, vec2};
use serde_json::json;

use crate::LightcraftApp;
use crate::icons::{Icon, paint};
use crate::theme::Tokens;
use crate::widgets::{icon_button, register};

/// The bar doubles as the window's title bar: dragging its empty space moves the window and a
/// double-click zooms or restores it. Registered before the bar's widgets so they win the click.
fn window_handle(app: &LightcraftApp, ui: &mut egui::Ui, bar: Rect, search_rect: Rect) {
    use crate::titlebar::{Gesture, WindowState, command_for};
    register(ui.ctx(), "region:titlebar", bar);
    let handle = egui::Id::new("titlebar-handle");
    let resp = ui.interact(bar, handle, Sense::click_and_drag());
    crate::widgets::announce(&resp, crate::i18n::tr("Title bar"));
    // a press that began on a button or the search field is theirs: dragging off it must not move the window
    // (while pressing, egui hovers every widget under the pointer; once the drag starts, only the dragged one)
    let ctx = ui.ctx().clone();
    let memo = egui::Id::new("titlebar-press-on-widget");
    if resp.is_pointer_button_down_on() && ctx.input(|i| i.pointer.primary_pressed()) {
        let hovered = ctx.interaction_snapshot(|s| s.hovered.clone());
        let on_widget =
            hovered.iter().any(|id| *id != handle && ctx.read_response(*id).is_some_and(|r| r.sense.senses_click() || r.sense.senses_drag()));
        ctx.data_mut(|d| d.insert_temp(memo, on_widget));
    }
    let on_widget = ctx.data(|d| d.get_temp::<bool>(memo)).unwrap_or(false);
    // The search field is drawn after this handle. Its hit-test response may not exist
    // yet when the press is recorded; the press origin still identifies text selection.
    let on_search = ui.input(|i| i.pointer.press_origin().is_some_and(|p| search_rect.contains(p)));
    let gesture = if resp.double_clicked_by(egui::PointerButton::Primary) && !on_search {
        Some(Gesture::DoubleClicked)
    } else if resp.drag_started_by(egui::PointerButton::Primary) && !on_widget && !on_search {
        Some(Gesture::DragStarted)
    } else {
        None
    };
    if let Some(g) = gesture {
        let window = WindowState { maximized: ui.input(|i| i.viewport().maximized).unwrap_or(false), fullscreen: app.window_is_fullscreen };
        if let Some(cmd) = command_for(g, window) {
            ui.ctx().send_viewport_cmd(cmd);
        }
    }
}

pub fn show(app: &mut LightcraftApp, ui: &mut egui::Ui) {
    let t = Tokens::get(ui.ctx());
    // room for the traffic lights; in full screen they are gone, and the sidebar button sits as far
    // from the left edge as the Discord button from the right (12 margin + 4)
    let left = match (app.integrated_titlebar, app.window_is_fullscreen) {
        (true, false) => 78,
        (true, true) => 16,
        (false, _) => 10,
    };
    egui::Panel::top("top_bar")
        .exact_size(t.top_bar_h)
        .frame(egui::Frame::NONE.fill(t.chrome).inner_margin(egui::Margin { left, right: 12, top: 0, bottom: 0 }))
        .show(ui, |ui| {
            let full = ui.max_rect();
            // The whole bar, its margins included. The search field is centred on this and not on
            // `full`, which is only what the margins leave: on macOS the left margin holds the
            // traffic lights' room, and full screen gives that room back. Centring on `full` moved
            // the field, and changed its width, every time that room changed (issue #2365).
            let bar = Rect::from_min_max(pos2(full.left() - left as f32, full.top()), pos2(full.right() + 12.0, full.bottom()));
            if app.integrated_titlebar {
                window_handle(app, ui, bar, Rect::NOTHING);
            }
            ui.horizontal_centered(|ui| {
                ui.spacing_mut().item_spacing.x = 4.0;
                if icon_button(ui, "sidebar", Icon::Sidebar, vec2(22.0, 22.0), app.ui.left_panel, true, crate::i18n::tr("Show/hide My Photos panel"))
                    .clicked()
                {
                    let _ = app.run("view.leftPanel", json!({}));
                }
                ui.add_space(4.0);
                if icon_button(ui, "back", Icon::Back, vec2(22.0, 22.0), false, true, crate::i18n::tr("Back")).clicked() {
                    let _ = app.run("view.back", json!({}));
                }
                icon_button(ui, "forward", Icon::Forward, vec2(22.0, 22.0), false, false, crate::i18n::tr("Forward"));
                if !app.native_menu {
                    ui.add_space(8.0);
                    let room = full.right() - ui.cursor().left() - 140.0;
                    crate::menubar::show_in_window(app, ui, room);
                }
            });
            let mut x = full.right() - 16.0;
            let unsaved = app.session.unsaved().map(|(n, e)| {
                crate::i18n::tr_format!(
                    "{n} change{} saved in memory but not written to disk: {e}\nLightCraft retries automatically; quitting now would lose {}.",
                    if n == 1 { "" } else { "s" },
                    if n == 1 { "it" } else { "them" },
                    e = e,
                    n = n
                )
            });
            // Import Photos… beside Export, always one click away, with the key it is bound to now
            let mac = ui.ctx().os() == egui::os::OperatingSystem::Mac;
            let import_tip = match crate::shortcuts::shortcut_of(&app.ui.settings.keymap, "file.addPhotos") {
                Some(sc) => format!("{} ({})", crate::i18n::tr("Import Photos…"), crate::menubar::shortcut_text(sc, mac)),
                None => crate::i18n::tr("Import Photos…").to_string(),
            };
            let mut bell = Rect::NOTHING;
            for (id, icon, tip, cmd) in [
                ("share", Icon::Share, "Export", "dialog.export"),
                ("import", Icon::Plus, import_tip.as_str(), "file.addPhotos"),
                ("bell", Icon::Bell, "Activity", "panel.activity"),
            ] {
                let r = Rect::from_center_size(pos2(x, full.center().y), vec2(28.0, 28.0));
                let tip =
                    if id == "bell" { unsaved.clone().unwrap_or_else(|| crate::i18n::tr(tip).to_string()) } else { crate::i18n::tr(tip).to_string() };
                let resp = ui.interact(r, egui::Id::new(("top", id)), Sense::click()).on_hover_text(tip.clone());
                crate::widgets::announce(&resp, tip);
                register(ui.ctx(), format!("icon:{id}"), r);
                if id == "bell" {
                    bell = r;
                }
                let colour = if id == "bell" && unsaved.is_some() {
                    t.caution
                } else if resp.hovered() {
                    t.text
                } else {
                    t.icon
                };
                paint(ui.painter(), r.shrink(5.0), icon, colour);
                // a refusal says why (Import while a Lightroom catalog is coming in)
                if resp.clicked()
                    && !cmd.is_empty()
                    && let Err(e) = app.run(cmd, json!({}))
                {
                    app.toast_error(ui.ctx(), e);
                }
                x -= 40.0;
            }
            if unsaved.is_some() {
                let c = bell.right_top() + vec2(-5.0, 6.0);
                ui.painter().circle_filled(c, 6.0, t.reject);
                ui.painter().text(c, Align2::CENTER_CENTER, "!", t.semibold(9.5), t.canvas);
                register(ui.ctx(), "indicator:unsaved", bell);
            }
            let r = Rect::from_center_size(pos2(x, full.center().y), vec2(28.0, 28.0));
            let tip = crate::i18n::tr("Settings");
            let resp = ui.interact(r, egui::Id::new(("top", "appearance")), Sense::click()).on_hover_text(tip);
            crate::widgets::announce(&resp, tip);
            register(ui.ctx(), "icon:appearance", r);
            paint(ui.painter(), r.shrink(6.0), Icon::Gear, if resp.hovered() { t.text } else { t.icon });
            if resp.clicked() {
                let open = ui.ctx().data(|d| d.get_temp::<bool>(customize_id())).unwrap_or(false);
                ui.ctx().data_mut(|d| d.insert_temp(customize_id(), !open));
            }
            crate::widgets::context_menu(&resp, |ui| {
                let settings = ui.button(crate::i18n::tr("Appearance Settings…"));
                register(ui.ctx(), "menu:appearanceSettings", settings.rect);
                if settings.clicked() {
                    let _ = app.run("app.settings", json!({"tab": "interface"}));
                    ui.close();
                }
                let favorites = app.ui.settings.favorite_themes.clone();
                for dark in [false, true] {
                    let group: Vec<_> =
                        crate::theme::ThemeKind::ALL.iter().filter(|k| k.is_dark() == dark && favorites.iter().any(|id| id == k.id())).collect();
                    if !group.is_empty() {
                        ui.separator();
                    }
                    for kind in group {
                        let r = ui.selectable_label(app.ui.settings.theme(app.system_theme(ui.ctx())) == *kind, crate::i18n::tr(kind.label()));
                        register(ui.ctx(), format!("menu:themeFavorite-{}", kind.id()), r.rect);
                        if r.clicked() {
                            let _ = app.run("view.theme", json!({"theme": kind.id()}));
                            ui.close();
                        }
                    }
                }
            });
            customize(app, ui.ctx());
        });
}

fn customize_id() -> egui::Id {
    egui::Id::new("rayfine-customize")
}

/// Settings gear, laid out like Rayfine's customize dialog: screen tiles, then Fond, Texte, Accent.
fn customize(app: &mut LightcraftApp, ctx: &egui::Context) {
    let open = ctx.data(|d| d.get_temp::<bool>(customize_id())).unwrap_or(false);
    if !open {
        return;
    }
    // A real dialog (Settings, import, …) takes the screen. Leave the gear panel out of the way.
    if app.ui.dialog.is_some() {
        ctx.data_mut(|d| d.insert_temp(customize_id(), false));
        return;
    }
    let screen = ctx.content_rect();
    let t = Tokens::get(ctx);
    let mut close = false;
    egui::Area::new(customize_id().with("dim")).order(egui::Order::Foreground).fixed_pos(screen.min).interactable(true).show(ctx, |ui| {
        let (r, resp) = ui.allocate_exact_size(screen.size(), Sense::click());
        ui.painter().rect_filled(r, 0.0, egui::Color32::from_black_alpha(140));
        if resp.clicked() {
            close = true;
        }
    });
    let width = 448.0_f32;
    let origin = pos2((screen.center().x - width / 2.0).max(screen.left() + 16.0), (screen.center().y - 230.0).max(screen.top() + 16.0));
    egui::Area::new(customize_id().with("panel")).order(egui::Order::Foreground).fixed_pos(origin).sense(Sense::click()).show(ctx, |ui| {
        egui::Frame::NONE
            .fill(t.chrome)
            .corner_radius(egui::CornerRadius::same(12))
            .stroke(egui::Stroke::new(1.0, t.divider.gamma_multiply(0.7)))
            .shadow(egui::epaint::Shadow { offset: [0, 18], blur: 48, spread: 0, color: egui::Color32::from_black_alpha(180) })
            .show(ui, |ui| {
                ui.set_width(width);
                let (head, _) = ui.allocate_exact_size(vec2(width, 44.0), Sense::hover());
                register(ui.ctx(), "dialog:customize", head);
                ui.painter().hline(head.x_range(), head.bottom(), egui::Stroke::new(1.0, t.divider.gamma_multiply(0.55)));
                ui.painter().text(
                    pos2(head.left() + 16.0, head.center().y),
                    Align2::LEFT_CENTER,
                    crate::i18n::tr("Paramètres"),
                    t.semibold(14.0),
                    t.text,
                );
                let x = Rect::from_center_size(pos2(head.right() - 28.0, head.center().y), vec2(32.0, 32.0));
                let close_btn = ui.interact(x, ui.id().with("customize-close"), Sense::click());
                if close_btn.hovered() {
                    ui.painter().rect_filled(x, 6.0, t.hover);
                }
                ui.painter().text(x.center(), Align2::CENTER_CENTER, "×", t.font(16.0), if close_btn.hovered() { t.text } else { t.text_dim });
                if close_btn.clicked() {
                    close = true;
                }
                egui::Frame::NONE.inner_margin(egui::Margin::symmetric(16, 16)).show(ui, |ui| {
                    ui.label(egui::RichText::new(crate::i18n::tr("Personnaliser").to_uppercase()).font(t.semibold(11.0)).color(t.text_dim));
                    ui.add_space(6.0);
                    ui.label(
                        egui::RichText::new(crate::i18n::tr("Deux thèmes de base. Les couleurs s’appliquent en direct."))
                            .size(12.0)
                            .color(t.text_dim),
                    );
                    ui.add_space(12.0);
                    let tile_w = (ui.available_width() - 8.0) / 2.0;
                    ui.horizontal(|ui| {
                        ui.spacing_mut().item_spacing.x = 8.0;
                        screen_tile(app, ui, false, tile_w);
                        screen_tile(app, ui, true, tile_w);
                    });
                    ui.add_space(20.0);
                    let light = app.ui.settings.appearance_mode == crate::state::AppearanceMode::Light;
                    let (canvas, text, accent) = app.ui.settings.screen_seeds.triple(light);
                    let mut next = (canvas, text, accent);
                    color_row(ui, "Fond", &mut next.0);
                    ui.add_space(10.0);
                    color_row(ui, "Texte", &mut next.1);
                    ui.add_space(10.0);
                    color_row(ui, "Accent", &mut next.2);
                    if next != (canvas, text, accent) {
                        app.ui.settings.screen_seeds.set_triple(light, next.0, next.1, next.2);
                    }
                    ui.add_space(14.0);
                    if reset_button(ui).clicked() {
                        let defaults = crate::theme::ScreenSeeds::default().triple(light);
                        app.ui.settings.screen_seeds.set_triple(light, defaults.0, defaults.1, defaults.2);
                    }
                });
            });
    });
    if close || ctx.input(|i| i.key_pressed(egui::Key::Escape)) {
        ctx.data_mut(|d| d.insert_temp(customize_id(), false));
    }
}

fn screen_tile(app: &mut LightcraftApp, ui: &mut egui::Ui, light: bool, width: f32) {
    let t = Tokens::get(ui.ctx());
    let on = (app.ui.settings.appearance_mode == crate::state::AppearanceMode::Light) == light
        && app.ui.settings.appearance_mode != crate::state::AppearanceMode::Auto;
    let (r, resp) = ui.allocate_exact_size(vec2(width, 104.0), Sense::click());
    if light {
        register(ui.ctx(), "button:screenLight", r);
    } else {
        register(ui.ctx(), "button:screenDark", r);
    }
    let bg = if on || resp.hovered() { t.hover } else { t.chrome };
    let stroke = if on { egui::Stroke::new(1.5, t.accent) } else { egui::Stroke::new(1.0, t.divider.gamma_multiply(0.7)) };
    ui.painter().rect_filled(r, 8.0, bg);
    ui.painter().rect_stroke(r, 8.0, stroke, egui::StrokeKind::Inside);
    let preview = Rect::from_min_max(r.min + vec2(8.0, 8.0), pos2(r.right() - 8.0, r.top() + 72.0));
    let (canvas, _, _) = app.ui.settings.screen_seeds.triple(light);
    let canvas_px = egui::Color32::from_rgb(canvas[0], canvas[1], canvas[2]);
    ui.painter().rect_filled(preview, 6.0, canvas_px);
    ui.painter().rect_stroke(preview, 6.0, egui::Stroke::new(1.0, egui::Color32::from_black_alpha(50)), egui::StrokeKind::Inside);
    let disc = if light { egui::Color32::from_rgb(0x2a, 0x2a, 0x2a) } else { egui::Color32::from_rgb(0xd8, 0xd8, 0xd6) };
    let c = preview.center();
    ui.painter().circle_filled(c, 20.0, disc);
    ui.painter().circle_filled(c + vec2(12.0, 1.0), 8.0, canvas_px);
    ui.painter().text(
        pos2(r.left() + 10.0, r.bottom() - 16.0),
        Align2::LEFT_CENTER,
        crate::i18n::tr(if light { "Clair" } else { "Sombre" }),
        t.semibold(12.0),
        t.text,
    );
    if resp.clicked() {
        let _ = app.run("view.appearance", json!({"mode": if light { "light" } else { "dark" }}));
    }
}

fn color_row(ui: &mut egui::Ui, label: &str, color: &mut [u8; 3]) {
    let t = Tokens::get(ui.ctx());
    let width = ui.available_width();
    ui.horizontal(|ui| {
        ui.set_min_width(width);
        ui.spacing_mut().item_spacing.x = 12.0;
        let (lab, _) = ui.allocate_exact_size(vec2(112.0, 36.0), Sense::hover());
        ui.painter().text(pos2(lab.left(), lab.center().y), Align2::LEFT_CENTER, crate::i18n::tr(label), t.font(12.0), t.text_dim);

        let (swatch, sw) = ui.allocate_exact_size(vec2(36.0, 36.0), Sense::click());
        let fill = egui::Color32::from_rgb(color[0], color[1], color[2]);
        ui.painter().rect_filled(swatch, 6.0, fill);
        ui.painter().rect_stroke(swatch, 6.0, egui::Stroke::new(1.0, t.divider.gamma_multiply(0.85)), egui::StrokeKind::Inside);
        let mut picked = fill;
        egui::Popup::from_toggle_button_response(&sw).close_behavior(egui::PopupCloseBehavior::CloseOnClickOutside).show(|ui| {
            ui.spacing_mut().slider_width = 210.0;
            if egui::color_picker::color_picker_color32(ui, &mut picked, egui::color_picker::Alpha::Opaque) {
                *color = [picked.r(), picked.g(), picked.b()];
            }
        });

        let rest = (width - 112.0 - 36.0 - 24.0).max(80.0);
        let key = ui.id().with(("seed-draft", label));
        let mut hex = ui.data(|d| d.get_temp::<String>(key)).unwrap_or_else(|| format!("#{:02x}{:02x}{:02x}", color[0], color[1], color[2]));
        let field = hex_field(ui, &mut hex, rest);
        register(ui.ctx(), format!("field:seed{label}"), field.rect);
        if field.changed() {
            let h = hex.trim().trim_start_matches('#');
            if h.len() == 6
                && let Ok(n) = u32::from_str_radix(h, 16)
            {
                *color = [(n >> 16) as u8, (n >> 8) as u8, n as u8];
            }
        }
        if field.has_focus() {
            ui.data_mut(|d| d.insert_temp(key, hex));
        } else {
            ui.data_mut(|d| d.remove::<String>(key));
        }
    });
}

fn hex_field(ui: &mut egui::Ui, hex: &mut String, width: f32) -> egui::Response {
    let t = Tokens::get(ui.ctx());
    ui.scope(|ui| {
        let widgets = &mut ui.visuals_mut().widgets;
        let radius = egui::CornerRadius::same(6);
        widgets.inactive.corner_radius = radius;
        widgets.hovered.corner_radius = radius;
        widgets.active.corner_radius = radius;
        widgets.open.corner_radius = radius;
        widgets.inactive.bg_fill = t.field;
        widgets.hovered.bg_fill = t.field;
        widgets.active.bg_fill = t.field;
        widgets.open.bg_fill = t.field;
        widgets.inactive.bg_stroke = egui::Stroke::new(1.0, t.field_border);
        widgets.hovered.bg_stroke = egui::Stroke::new(1.0, t.field_border);
        widgets.active.bg_stroke = egui::Stroke::new(1.0, t.accent.gamma_multiply(0.7));
        widgets.open.bg_stroke = egui::Stroke::new(1.0, t.accent.gamma_multiply(0.7));
        widgets.inactive.fg_stroke.color = t.text;
        widgets.hovered.fg_stroke.color = t.text;
        widgets.active.fg_stroke.color = t.text;
        ui.add_sized(
            vec2(width, 36.0),
            egui::TextEdit::singleline(hex)
                .font(egui::FontId::monospace(12.0))
                .desired_width(width)
                .min_size(vec2(width, 36.0))
                .margin(egui::Margin::symmetric(8, 0)),
        )
    })
    .inner
}

fn reset_button(ui: &mut egui::Ui) -> egui::Response {
    let t = Tokens::get(ui.ctx());
    let label = crate::i18n::tr("Réinitialiser ce thème");
    let galley = ui.painter().layout_no_wrap(label.to_string(), t.font(12.0), t.text_dim);
    let (rect, resp) = ui.allocate_exact_size(vec2(galley.size().x + 24.0, 32.0), Sense::click());
    if resp.hovered() {
        ui.painter().rect_filled(rect, 6.0, t.hover);
    }
    ui.painter().rect_stroke(rect, 6.0, egui::Stroke::new(1.0, t.divider.gamma_multiply(0.7)), egui::StrokeKind::Inside);
    ui.painter().text(rect.center(), Align2::CENTER_CENTER, label, t.font(12.0), if resp.hovered() { t.text } else { t.text_dim });
    resp
}

/// The appearance button's icon and the mode's name for its tooltip.
pub fn appearance_icon(mode: crate::state::AppearanceMode) -> (Icon, &'static str) {
    use crate::state::AppearanceMode;
    match mode {
        AppearanceMode::Auto => (Icon::Monitor, "Sync with System"),
        AppearanceMode::Light => (Icon::Sun, "Light Mode"),
        AppearanceMode::Dark => (Icon::Moon, "Dark Mode"),
    }
}
