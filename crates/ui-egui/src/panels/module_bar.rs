//! Library and Develop. The other Lightroom workspaces (Map, Book, Slideshow, Print, Web) are not tabs.

use egui::{Align2, Rect, Sense, pos2, vec2};

use crate::LightcraftApp;
use crate::state::AppModule;
use crate::theme::Tokens;
use crate::widgets::register;

const TABS: &[(AppModule, &str, &str)] = &[(AppModule::Library, "library", "Library"), (AppModule::Develop, "develop", "Develop")];

pub fn show(app: &mut LightcraftApp, ui: &mut egui::Ui) {
    let t = Tokens::get(ui.ctx());
    egui::Panel::top("module_bar")
        .exact_size(38.0)
        .frame(egui::Frame::NONE.fill(t.chrome).inner_margin(egui::Margin { left: 12, right: 8, top: 0, bottom: 0 }).stroke(egui::Stroke::new(1.0, t.divider)))
        .show(ui, |ui| {
            ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                ui.spacing_mut().item_spacing.x = 0.0;
                for &(module, id, label) in TABS.iter().rev() {
                    let text = crate::i18n::tr(label).to_uppercase();
                    let galley = ui.painter().layout_no_wrap(text.clone(), t.semibold(12.0), t.text);
                    let (r, resp) = ui.allocate_exact_size(vec2(galley.size().x + 32.0, 38.0), Sense::click());
                    let on = app.ui.module == module;
                    resp.widget_info(|| egui::WidgetInfo::selected(egui::WidgetType::Button, true, on, &text));
                    register(ui.ctx(), format!("tab:{id}"), r);
                    if on {
                        ui.painter().rect_filled(r, 0.0, t.accent.gamma_multiply(0.22));
                    } else if resp.hovered() {
                        ui.painter().rect_filled(r, 0.0, t.hover);
                    }
                    let color = if on { t.text } else { t.text_dim };
                    ui.painter().galley(pos2(r.center().x - galley.size().x / 2.0, r.center().y - galley.size().y / 2.0), galley, color);
                    if on {
                        let bar = Rect::from_min_max(pos2(r.left() + 8.0, r.bottom() - 3.0), pos2(r.right() - 8.0, r.bottom()));
                        ui.painter().rect_filled(bar, 0.0, t.accent);
                    }
                    if resp.clicked() && !on {
                        let command = match module {
                            AppModule::Library => "view.library",
                            AppModule::Develop => "view.develop",
                        };
                        let _ = app.run(command, serde_json::json!({}));
                    }
                }
                let (mark, _) = ui.allocate_exact_size(vec2(ui.available_width(), 38.0), Sense::hover());
                ui.painter().text(pos2(mark.left(), mark.center().y), Align2::LEFT_CENTER, "RAYFINE", t.semibold(11.0), t.text_dim);
            });
        });
}
