//! Develop's left column, in Rayfine's order: Navigator, Presets, History, Collections, then Copy / Paste.

use egui::{Align2, Color32, Rect, Sense, pos2, vec2};
use serde_json::json;

use crate::LightcraftApp;
use crate::icons::{Icon, paint};
use crate::panels::grid::request_thumb;
use crate::panels::right::history_rows;
use crate::theme::Tokens;
use crate::widgets::{register, text_button};

pub fn show(app: &mut LightcraftApp, ui: &mut egui::Ui) {
    let t = Tokens::get(ui.ctx());
    egui::Frame::NONE.fill(t.chrome).show(ui, |ui| {
        ui.spacing_mut().item_spacing.y = 0.0;
        let footer = 32.0;
        let height = (ui.available_height() - footer).max(0.0);
        egui::ScrollArea::vertical().id_salt("develop-left").auto_shrink([false, false]).max_height(height).show(ui, |ui| {
            ui.spacing_mut().item_spacing.y = 0.0;
            if rail_section(app, ui, "devNav", "Navigator") {
                navigator(app, ui);
            }
            if rail_section(app, ui, "devPresets", "Presets") {
                presets(app, ui);
            }
            if rail_section(app, ui, "devHistory", "History") {
                if let Some(id) = app.session.active() {
                    history_rows(app, ui, id);
                }
            }
            if rail_section(app, ui, "devCollections", "Collections") {
                collections(app, ui);
            }
        });
        copy_paste_bar(app, ui);
    });
}

/// Chevron on the left, small uppercase title, like Rayfine's left sections.
fn rail_section(app: &mut LightcraftApp, ui: &mut egui::Ui, id: &str, title: &str) -> bool {
    let t = Tokens::get(ui.ctx());
    let (r, resp) = ui.allocate_exact_size(vec2(ui.available_width(), 28.0), Sense::click());
    let open = !app.ui.section_folded(id);
    let label = crate::i18n::tr(title).to_uppercase();
    resp.widget_info(|| egui::WidgetInfo::selected(egui::WidgetType::CollapsingHeader, true, open, &label));
    register(ui.ctx(), format!("section:{id}"), r);
    let p = ui.painter();
    p.hline(r.x_range(), r.bottom(), egui::Stroke::new(1.0, t.divider));
    if resp.hovered() {
        p.rect_filled(r, 0.0, t.hover.gamma_multiply(0.6));
    }
    let chevron = Rect::from_center_size(pos2(r.left() + 14.0, r.center().y), vec2(12.0, 12.0));
    paint(p, chevron, if open { Icon::ChevronDown } else { Icon::ChevronRight }, t.text_dim);
    p.text(pos2(r.left() + 26.0, r.center().y), Align2::LEFT_CENTER, label, t.semibold(10.5), t.text_dim);
    if resp.clicked() {
        app.ui.toggle_folded(id);
    }
    open
}

fn copy_paste_bar(app: &mut LightcraftApp, ui: &mut egui::Ui) {
    let t = Tokens::get(ui.ctx());
    let (bar, _) = ui.allocate_exact_size(vec2(ui.available_width(), 32.0), Sense::hover());
    ui.painter().hline(bar.x_range(), bar.top(), egui::Stroke::new(1.0, t.divider));
    ui.painter().vline(bar.center().x, bar.y_range(), egui::Stroke::new(1.0, t.divider));
    let half = bar.width() / 2.0;
    let copy = Rect::from_min_size(bar.min, vec2(half, bar.height()));
    let paste = Rect::from_min_size(pos2(bar.left() + half, bar.top()), vec2(bar.width() - half, bar.height()));
    let has_photo = app.session.active().is_some();
    let can_paste = app.session.clipboard.is_some();
    if ui.put(copy, egui::Button::new(crate::i18n::tr("Copy")).frame(false)).clicked() && has_photo {
        let _ = app.run("develop.copy", json!({}));
    }
    register(ui.ctx(), "button:developCopy", copy);
    if ui.put(paste, egui::Button::new(crate::i18n::tr("Paste")).frame(false)).clicked() && has_photo && can_paste {
        let _ = app.run("develop.paste", json!({}));
    }
    register(ui.ctx(), "button:developPaste", paste);
    if !can_paste {
        ui.painter().rect_filled(paste, 0.0, t.chrome.gamma_multiply(0.65));
        ui.painter().text(paste.center(), Align2::CENTER_CENTER, crate::i18n::tr("Paste"), t.font(12.0), t.text_disabled);
    }
}

fn navigator(app: &mut LightcraftApp, ui: &mut egui::Ui) {
    let t = Tokens::get(ui.ctx());
    let (r, _) = ui.allocate_exact_size(vec2(ui.available_width(), 140.0), Sense::hover());
    let frame = Rect::from_min_max(r.min + vec2(12.0, 4.0), r.max - vec2(12.0, 28.0));
    ui.painter().rect_filled(frame, 2.0, t.canvas);
    if let Some(id) = app.session.active() {
        request_thumb(app, id, 320, 8);
        if let Some(tex) = app.renderer.thumb(id) {
            let fit = crate::panels::detail::fit_texture_rect(frame.shrink(4.0), tex.size);
            ui.painter().image(tex.tex.id(), fit, Rect::from_min_max(pos2(0.0, 0.0), pos2(1.0, 1.0)), Color32::WHITE);
        }
        if let Some(photo) = app.session.catalog.photo(id) {
            ui.painter().text(
                pos2(frame.left(), frame.bottom() + 8.0),
                Align2::LEFT_CENTER,
                &photo.file_name,
                t.font(11.0),
                t.text_dim,
            );
        }
    }
    let mut tools = ui.new_child(
        egui::UiBuilder::new()
            .max_rect(Rect::from_min_max(pos2(frame.right() - 92.0, frame.bottom() + 2.0), pos2(frame.right(), r.bottom())))
            .layout(egui::Layout::right_to_left(egui::Align::Center)),
    );
    if text_button(&mut tools, "nav100", "1:1", false).clicked() {
        let _ = app.run("view.zoom100", json!({}));
    }
    if text_button(&mut tools, "navFit", "Fit", false).clicked() {
        let _ = app.run("view.zoomFit", json!({}));
    }
}

fn presets(app: &mut LightcraftApp, ui: &mut egui::Ui) {
    let t = Tokens::get(ui.ctx());
    let rows: Vec<(String, String, String)> =
        app.session.presets.iter().map(|p| (p.group.clone(), p.name.clone(), p.id.clone())).collect();
    if rows.is_empty() {
        let (r, _) = ui.allocate_exact_size(vec2(ui.available_width(), 28.0), Sense::hover());
        ui.painter().text(pos2(r.left() + 16.0, r.center().y), Align2::LEFT_CENTER, crate::i18n::tr("No presets"), t.font(12.0), t.text_dim);
        return;
    }
    let mut group = String::new();
    for (g, name, id) in rows {
        if g != group {
            group = g.clone();
            let (r, _) = ui.allocate_exact_size(vec2(ui.available_width(), 22.0), Sense::hover());
            ui.painter().text(pos2(r.left() + 16.0, r.center().y), Align2::LEFT_CENTER, &group, t.semibold(11.0), t.text_dim);
        }
        let (r, resp) = ui.allocate_exact_size(vec2(ui.available_width(), 24.0), Sense::click());
        register(ui.ctx(), format!("developPreset:{id}"), r);
        if resp.hovered() {
            ui.painter().rect_filled(r, 0.0, t.hover);
        }
        ui.painter().text(pos2(r.left() + 24.0, r.center().y), Align2::LEFT_CENTER, &name, t.font(12.5), t.text);
        if resp.clicked() {
            let _ = app.run("preset.apply", json!({"id": id, "amount": 100}));
        }
    }
}

fn collections(app: &mut LightcraftApp, ui: &mut egui::Ui) {
    let t = Tokens::get(ui.ctx());
    let mut rows: Vec<(u64, String, bool, usize)> =
        app.session.catalog.albums().map(|a| (a.id.0, a.name.clone(), a.quick, if a.folder { 0 } else { a.photos.len() })).collect();
    rows.sort_by(|a, b| b.2.cmp(&a.2).then(a.1.cmp(&b.1)));
    if rows.is_empty() {
        let (r, _) = ui.allocate_exact_size(vec2(ui.available_width(), 28.0), Sense::hover());
        ui.painter().text(pos2(r.left() + 16.0, r.center().y), Align2::LEFT_CENTER, crate::i18n::tr("No albums yet"), t.font(12.0), t.text_dim);
        return;
    }
    for (id, name, _quick, count) in rows {
        let (r, resp) = ui.allocate_exact_size(vec2(ui.available_width(), 26.0), Sense::click());
        register(ui.ctx(), format!("developAlbum:{id}"), r);
        if resp.hovered() {
            ui.painter().rect_filled(r, 0.0, t.hover);
        }
        ui.painter().text(pos2(r.left() + 16.0, r.center().y), Align2::LEFT_CENTER, &name, t.font(12.5), t.text);
        ui.painter().text(pos2(r.right() - 16.0, r.center().y), Align2::RIGHT_CENTER, count.to_string(), t.font(11.0), t.text_dim);
        if resp.clicked() {
            let _ = app.run("library.source", json!({"kind": "album", "id": id}));
        }
    }
}
