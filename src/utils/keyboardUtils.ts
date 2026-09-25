export interface KeybindDefinition {
  action: string;
  description: string;
  defaultCombo: string[];
  section: 'library' | 'view' | 'rating' | 'panels' | 'editing';
}

export interface KeybindSection {
  id: KeybindDefinition['section'];
  label: string;
}

export const KEYBIND_SECTIONS: KeybindSection[] = [
  { id: 'library', label: 'settings.keybinds.sections.library' },
  { id: 'editing', label: 'settings.keybinds.sections.editing' },
  { id: 'view', label: 'settings.keybinds.sections.view' },
  { id: 'rating', label: 'settings.keybinds.sections.rating' },
  { id: 'panels', label: 'settings.keybinds.sections.panels' },
];

export const KEYBIND_DEFINITIONS: KeybindDefinition[] = [
  {
    action: 'open_image',
    description: 'settings.keybinds.actions.open_image',
    defaultCombo: ['Enter'],
    section: 'library',
  },
  {
    action: 'go_to_library',
    description: 'settings.keybinds.actions.go_to_library',
    defaultCombo: ['KeyG'],
    section: 'library',
  },
  {
    action: 'go_to_develop',
    description: 'settings.keybinds.actions.go_to_develop',
    // LR uses D for Develop; RapidRAW also uses D for Adjustments panel when already editing
    defaultCombo: ['shift', 'KeyD'],
    section: 'library',
  },
  {
    action: 'module_library',
    description: 'settings.keybinds.actions.module_library',
    defaultCombo: ['ctrl', 'alt', 'Digit1'],
    section: 'library',
  },
  {
    action: 'module_develop',
    description: 'settings.keybinds.actions.module_develop',
    defaultCombo: ['ctrl', 'alt', 'Digit2'],
    section: 'library',
  },
  {
    action: 'module_map',
    description: 'settings.keybinds.actions.module_map',
    defaultCombo: ['ctrl', 'alt', 'Digit3'],
    section: 'library',
  },
  {
    action: 'module_border',
    description: 'settings.keybinds.actions.module_border',
    defaultCombo: ['ctrl', 'alt', 'Digit6'],
    section: 'library',
  },
  {
    action: 'module_web',
    description: 'settings.keybinds.actions.module_web',
    defaultCombo: ['ctrl', 'alt', 'Digit7'],
    section: 'library',
  },
  {
    action: 'library_view_grid',
    description: 'settings.keybinds.actions.library_view_grid',
    defaultCombo: ['shift', 'Digit1'],
    section: 'library',
  },
  {
    action: 'library_view_loupe',
    description: 'settings.keybinds.actions.library_view_loupe',
    defaultCombo: ['shift', 'Digit2'],
    section: 'library',
  },
  {
    action: 'library_view_compare',
    description: 'settings.keybinds.actions.library_view_compare',
    defaultCombo: ['shift', 'Digit3'],
    section: 'library',
  },
  {
    action: 'compare_swap',
    description: 'settings.keybinds.actions.compare_swap',
    defaultCombo: ['shift', 'KeyS'],
    section: 'library',
  },
  {
    action: 'library_view_survey',
    description: 'settings.keybinds.actions.library_view_survey',
    defaultCombo: ['shift', 'Digit4'],
    section: 'library',
  },
  {
    action: 'library_view_cull',
    description: 'settings.keybinds.actions.library_view_cull',
    defaultCombo: ['shift', 'Digit5'],
    section: 'library',
  },
  {
    action: 'library_view_list',
    description: 'settings.keybinds.actions.library_view_list',
    defaultCombo: ['shift', 'Digit6'],
    section: 'library',
  },

  {
    action: 'reimport_xmp',
    description: 'settings.keybinds.actions.reimport_xmp',
    defaultCombo: ['ctrl', 'shift', 'KeyX'],
    section: 'editing',
  },
  {
    action: 'export_develop_xmp',
    description: 'settings.keybinds.actions.export_develop_xmp',
    defaultCombo: ['ctrl', 'shift', 'KeyE'],
    section: 'editing',
  },
  {
    action: 'create_snapshot',
    description: 'settings.keybinds.actions.create_snapshot',
    defaultCombo: ['ctrl', 'shift', 'KeyS'],
    section: 'editing',
  },
  {
    action: 'snapshot_next',
    description: 'settings.keybinds.actions.snapshot_next',
    defaultCombo: ['ctrl', 'shift', 'ArrowDown'],
    section: 'editing',
  },
  {
    action: 'snapshot_prev',
    description: 'settings.keybinds.actions.snapshot_prev',
    defaultCombo: ['ctrl', 'shift', 'ArrowUp'],
    section: 'editing',
  },
  {
    action: 'delete_snapshot',
    description: 'settings.keybinds.actions.delete_snapshot',
    defaultCombo: ['ctrl', 'shift', 'Backspace'],
    section: 'editing',
  },
  {
    action: 'rename_snapshot',
    description: 'settings.keybinds.actions.rename_snapshot',
    defaultCombo: ['F2'],
    section: 'editing',
  },
  {
    action: 'auto_tone',
    description: 'settings.keybinds.actions.auto_tone',
    defaultCombo: ['ctrl', 'shift', 'KeyU'],
    section: 'editing',
  },
  {
    action: 'reset_develop',
    description: 'settings.keybinds.actions.reset_develop',
    defaultCombo: ['ctrl', 'shift', 'KeyR'],
    section: 'editing',
  },
  {
    action: 'copy_files',
    description: 'settings.keybinds.actions.copy_files',
    defaultCombo: ['ctrl', 'shift', 'KeyC'],
    section: 'library',
  },
  {
    action: 'paste_files',
    description: 'settings.keybinds.actions.paste_files',
    defaultCombo: ['ctrl', 'shift', 'KeyV'],
    section: 'library',
  },
  {
    action: 'filter_selected_only',
    description: 'settings.keybinds.actions.filter_selected_only',
    defaultCombo: ['ctrl', 'alt', 'KeyA'],
    section: 'library',
  },
  {
    action: 'clear_keywords',
    description: 'settings.keybinds.actions.clear_keywords',
    defaultCombo: ['ctrl', 'alt', 'KeyD'],
    section: 'library',
  },
  {
    action: 'add_keyword_prompt',
    description: 'settings.keybinds.actions.add_keyword_prompt',
    defaultCombo: ['ctrl', 'alt', 'KeyK'],
    section: 'library',
  },
  {
    action: 'select_all',
    description: 'settings.keybinds.actions.select_all',
    defaultCombo: ['ctrl', 'KeyA'],
    section: 'library',
  },
  {
    action: 'select_none',
    description: 'settings.keybinds.actions.select_none',
    defaultCombo: ['ctrl', 'KeyD'],
    section: 'library',
  },
  {
    action: 'first_photo',
    description: 'settings.keybinds.actions.first_photo',
    defaultCombo: ['Home'],
    section: 'library',
  },
  {
    action: 'last_photo',
    description: 'settings.keybinds.actions.last_photo',
    defaultCombo: ['End'],
    section: 'library',
  },
  {
    action: 'sort_by_capture',
    description: 'settings.keybinds.actions.sort_by_capture',
    defaultCombo: ['ctrl', 'alt', 'KeyY'],
    section: 'library',
  },
  {
    action: 'sort_by_rating',
    description: 'settings.keybinds.actions.sort_by_rating',
    defaultCombo: ['ctrl', 'alt', 'KeyU'],
    section: 'library',
  },
  {
    action: 'sort_by_name',
    description: 'settings.keybinds.actions.sort_by_name',
    defaultCombo: ['ctrl', 'alt', 'KeyO'],
    section: 'library',
  },
  {
    action: 'toggle_sort_direction',
    description: 'settings.keybinds.actions.toggle_sort_direction',
    defaultCombo: ['ctrl', 'alt', 'KeyW'],
    section: 'library',
  },
  {
    action: 'sort_by_flag',
    description: 'settings.keybinds.actions.sort_by_flag',
    defaultCombo: ['ctrl', 'alt', 'Digit8'],
    section: 'library',
  },
  {
    action: 'sort_by_color',
    description: 'settings.keybinds.actions.sort_by_color',
    defaultCombo: ['ctrl', 'alt', 'Digit9'],
    section: 'library',
  },
  {
    action: 'sort_by_edited',
    description: 'settings.keybinds.actions.sort_by_edited',
    defaultCombo: ['ctrl', 'alt', 'Digit0'],
    section: 'library',
  },
  {
    action: 'cycle_sort_field',
    description: 'settings.keybinds.actions.cycle_sort_field',
    defaultCombo: ['ctrl', 'alt', 'shift', 'Comma'],
    section: 'library',
  },
  {
    action: 'invert_selection',
    description: 'settings.keybinds.actions.invert_selection',
    defaultCombo: ['ctrl', 'shift', 'KeyI'],
    section: 'library',
  },
  {
    action: 'cycle_lights_out',
    description: 'settings.keybinds.actions.cycle_lights_out',
    defaultCombo: ['ctrl', 'shift', 'KeyL'],
    section: 'library',
  },
  {
    action: 'delete_selected',
    description: 'settings.keybinds.actions.delete_selected',
    defaultCombo: ['Delete'],
    section: 'library',
  },
  {
    action: 'preview_prev',
    description: 'settings.keybinds.actions.preview_prev',
    defaultCombo: ['ArrowLeft'],
    section: 'library',
  },
  {
    action: 'preview_next',
    description: 'settings.keybinds.actions.preview_next',
    defaultCombo: ['ArrowRight'],
    section: 'library',
  },
  {
    action: 'zoom_in_step',
    description: 'settings.keybinds.actions.zoom_in_step',
    defaultCombo: ['ArrowUp'],
    section: 'view',
  },
  {
    action: 'zoom_out_step',
    description: 'settings.keybinds.actions.zoom_out_step',
    defaultCombo: ['ArrowDown'],
    section: 'view',
  },
  {
    action: 'cycle_zoom',
    description: 'settings.keybinds.actions.cycle_zoom',
    defaultCombo: ['Space'],
    section: 'view',
  },
  {
    action: 'zoom_in',
    description: 'settings.keybinds.actions.zoom_in',
    defaultCombo: ['ctrl', 'Equal'],
    section: 'view',
  },
  {
    action: 'zoom_out',
    description: 'settings.keybinds.actions.zoom_out',
    defaultCombo: ['ctrl', 'Minus'],
    section: 'view',
  },
  {
    action: 'zoom_fit',
    description: 'settings.keybinds.actions.zoom_fit',
    defaultCombo: ['ctrl', 'Digit0'],
    section: 'view',
  },
  {
    action: 'zoom_100',
    description: 'settings.keybinds.actions.zoom_100',
    defaultCombo: ['ctrl', 'Digit1'],
    section: 'view',
  },
  {
    action: 'loupe_cycle_zoom',
    description: 'settings.keybinds.actions.loupe_cycle_zoom',
    defaultCombo: ['KeyZ'],
    section: 'view',
  },
  {
    action: 'toggle_quick_filter',
    description: 'settings.keybinds.actions.toggle_quick_filter',
    defaultCombo: ['Slash'],
    section: 'library',
  },
  {
    action: 'cycle_filmstrip_scope',
    description: 'settings.keybinds.actions.cycle_filmstrip_scope',
    defaultCombo: ['Period'],
    section: 'library',
  },
  {
    action: 'cycle_filmstrip_scope_prev',
    description: 'settings.keybinds.actions.cycle_filmstrip_scope_prev',
    defaultCombo: ['Comma'],
    section: 'library',
  },
  {
    action: 'cycle_exif_overlay',
    description: 'settings.keybinds.actions.cycle_exif_overlay',
    defaultCombo: ['Semicolon'],
    section: 'library',
  },
  {
    action: 'library_thumb_larger',
    description: 'settings.keybinds.actions.library_thumb_larger',
    defaultCombo: ['Equal'],
    section: 'library',
  },
  {
    action: 'library_thumb_smaller',
    description: 'settings.keybinds.actions.library_thumb_smaller',
    defaultCombo: ['Minus'],
    section: 'library',
  },
  {
    action: 'toggle_fullscreen',
    description: 'settings.keybinds.actions.toggle_fullscreen',
    defaultCombo: ['KeyF'],
    section: 'view',
  },
  {
    action: 'toggle_side_panels',
    description: 'settings.keybinds.actions.toggle_side_panels',
    defaultCombo: ['Tab'],
    section: 'view',
  },
  {
    action: 'toggle_filmstrip',
    description: 'settings.keybinds.actions.toggle_filmstrip',
    defaultCombo: ['F5'],
    section: 'view',
  },
  {
    action: 'toggle_left_panels',
    description: 'settings.keybinds.actions.toggle_left_panels',
    defaultCombo: ['F6'],
    section: 'view',
  },
  {
    action: 'toggle_right_panels',
    description: 'settings.keybinds.actions.toggle_right_panels',
    defaultCombo: ['F7'],
    section: 'view',
  },
  {
    action: 'toggle_all_panels',
    description: 'settings.keybinds.actions.toggle_all_panels',
    defaultCombo: ['shift', 'Tab'],
    section: 'view',
  },
  {
    action: 'show_original',
    description: 'settings.keybinds.actions.show_original',
    defaultCombo: ['KeyO'],
    section: 'view',
  },
  {
    action: 'toggle_clipping',
    description: 'settings.keybinds.actions.toggle_clipping',
    defaultCombo: ['KeyJ'],
    section: 'view',
  },
  {
    action: 'toggle_quick_collection',
    description: 'settings.keybinds.actions.toggle_quick_collection',
    defaultCombo: ['KeyB'],
    section: 'rating',
  },
  {
    action: 'show_quick_collection',
    description: 'settings.keybinds.actions.show_quick_collection',
    defaultCombo: ['ctrl', 'KeyB'],
    section: 'library',
  },
  {
    action: 'clear_quick_collection',
    description: 'settings.keybinds.actions.clear_quick_collection',
    defaultCombo: ['ctrl', 'shift', 'KeyB'],
    section: 'rating',
  },
  {
    action: 'add_picks_to_target',
    description: 'settings.keybinds.actions.add_picks_to_target',
    defaultCombo: ['ctrl', 'alt', 'KeyB'],
    section: 'library',
  },
  {
    action: 'clear_filters',
    description: 'settings.keybinds.actions.clear_filters',
    defaultCombo: ['ctrl', 'alt', 'KeyL'],
    section: 'library',
  },
  {
    action: 'save_filter_preset',
    description: 'settings.keybinds.actions.save_filter_preset',
    defaultCombo: ['ctrl', 'alt', 'KeyF'],
    section: 'library',
  },
  {
    action: 'cycle_virtual_copy_next',
    description: 'settings.keybinds.actions.cycle_virtual_copy_next',
    defaultCombo: ['PageDown'],
    section: 'library',
  },
  {
    action: 'cycle_virtual_copy_prev',
    description: 'settings.keybinds.actions.cycle_virtual_copy_prev',
    defaultCombo: ['PageUp'],
    section: 'library',
  },
  {
    action: 'create_virtual_copy',
    description: 'settings.keybinds.actions.create_virtual_copy',
    defaultCombo: ['ctrl', 'alt', 'KeyV'],
    section: 'library',
  },

  { action: 'rate_0', description: 'settings.keybinds.actions.rate_0', defaultCombo: ['Digit0'], section: 'rating' },
  { action: 'rate_1', description: 'settings.keybinds.actions.rate_1', defaultCombo: ['Digit1'], section: 'rating' },
  { action: 'rate_2', description: 'settings.keybinds.actions.rate_2', defaultCombo: ['Digit2'], section: 'rating' },
  { action: 'rate_3', description: 'settings.keybinds.actions.rate_3', defaultCombo: ['Digit3'], section: 'rating' },
  { action: 'rate_4', description: 'settings.keybinds.actions.rate_4', defaultCombo: ['Digit4'], section: 'rating' },
  { action: 'rate_5', description: 'settings.keybinds.actions.rate_5', defaultCombo: ['Digit5'], section: 'rating' },
  {
    action: 'flag_pick',
    description: 'settings.keybinds.actions.flag_pick',
    defaultCombo: ['KeyP'],
    section: 'rating',
  },
  {
    action: 'flag_reject',
    description: 'settings.keybinds.actions.flag_reject',
    defaultCombo: ['KeyX'],
    section: 'rating',
  },
  {
    action: 'flag_unflag',
    description: 'settings.keybinds.actions.flag_unflag',
    defaultCombo: ['KeyU'],
    section: 'rating',
  },
  {
    action: 'cycle_flag',
    description: 'settings.keybinds.actions.cycle_flag',
    defaultCombo: ['Backquote'],
    section: 'rating',
  },
  {
    action: 'select_flagged_picks',
    description: 'settings.keybinds.actions.select_flagged_picks',
    defaultCombo: ['ctrl', 'alt', 'shift', 'KeyP'],
    section: 'library',
  },
  {
    action: 'select_flagged_rejects',
    description: 'settings.keybinds.actions.select_flagged_rejects',
    defaultCombo: ['ctrl', 'alt', 'shift', 'KeyX'],
    section: 'library',
  },
  {
    action: 'select_flagged_any',
    description: 'settings.keybinds.actions.select_flagged_any',
    defaultCombo: ['ctrl', 'alt', 'shift', 'KeyV'],
    section: 'library',
  },
  {
    action: 'select_unrated',
    description: 'settings.keybinds.actions.select_unrated',
    defaultCombo: ['ctrl', 'alt', 'shift', 'Digit0'],
    section: 'library',
  },
  {
    action: 'select_five_star',
    description: 'settings.keybinds.actions.select_five_star',
    defaultCombo: ['ctrl', 'alt', 'KeyX'],
    section: 'library',
  },
  {
    action: 'select_zero_star',
    description: 'settings.keybinds.actions.select_zero_star',
    defaultCombo: ['ctrl', 'alt', 'KeyZ'],
    section: 'library',
  },
  {
    action: 'select_rated',
    description: 'settings.keybinds.actions.select_rated',
    defaultCombo: ['ctrl', 'alt', 'shift', 'Digit5'],
    section: 'library',
  },
  {
    action: 'select_same_rating',
    description: 'settings.keybinds.actions.select_same_rating',
    defaultCombo: ['ctrl', 'alt', 'shift', 'Digit2'],
    section: 'library',
  },
  {
    action: 'select_same_orientation',
    description: 'settings.keybinds.actions.select_same_orientation',
    defaultCombo: ['ctrl', 'alt', 'shift', 'Digit3'],
    section: 'library',
  },
  {
    action: 'go_to_map_selection',
    description: 'settings.keybinds.actions.go_to_map_selection',
    defaultCombo: ['ctrl', 'alt', 'KeyM'],
    section: 'library',
  },
  {
    action: 'select_gps',
    description: 'settings.keybinds.actions.select_gps',
    defaultCombo: ['ctrl', 'alt', 'shift', 'Digit4'],
    section: 'library',
  },
  {
    action: 'select_has_caption',
    description: 'settings.keybinds.actions.select_has_caption',
    defaultCombo: ['ctrl', 'alt', 'shift', 'Digit1'],
    section: 'library',
  },
  {
    action: 'select_has_location',
    description: 'settings.keybinds.actions.select_has_location',
    defaultCombo: ['ctrl', 'alt', 'shift', 'Digit6'],
    section: 'library',
  },
  {
    action: 'cycle_library_display',
    description: 'settings.keybinds.actions.cycle_library_display',
    defaultCombo: ['ctrl', 'alt', 'KeyQ'],
    section: 'library',
  },
  {
    action: 'show_in_finder',
    description: 'settings.keybinds.actions.show_in_finder',
    defaultCombo: ['ctrl', 'alt', 'KeyJ'],
    section: 'library',
  },
  {
    action: 'copy_filename',
    description: 'settings.keybinds.actions.copy_filename',
    defaultCombo: ['ctrl', 'alt', 'KeyC'],
    section: 'library',
  },
  {
    action: 'copy_file_path',
    description: 'settings.keybinds.actions.copy_file_path',
    defaultCombo: ['ctrl', 'alt', 'KeyI'],
    section: 'library',
  },
  {
    action: 'select_unflagged',
    description: 'settings.keybinds.actions.select_unflagged',
    defaultCombo: ['ctrl', 'alt', 'shift', 'KeyU'],
    section: 'library',
  },
  {
    action: 'select_edited',
    description: 'settings.keybinds.actions.select_edited',
    defaultCombo: ['ctrl', 'alt', 'shift', 'KeyE'],
    section: 'library',
  },
  {
    action: 'select_unedited',
    description: 'settings.keybinds.actions.select_unedited',
    defaultCombo: ['ctrl', 'alt', 'shift', 'KeyN'],
    section: 'library',
  },
  {
    action: 'select_raw',
    description: 'settings.keybinds.actions.select_raw',
    defaultCombo: ['ctrl', 'alt', 'shift', 'Digit7'],
    section: 'library',
  },
  {
    action: 'select_non_raw',
    description: 'settings.keybinds.actions.select_non_raw',
    defaultCombo: ['ctrl', 'alt', 'shift', 'Digit8'],
    section: 'library',
  },
  {
    action: 'select_virtual_copies',
    description: 'settings.keybinds.actions.select_virtual_copies',
    defaultCombo: ['ctrl', 'alt', 'shift', 'Digit9'],
    section: 'library',
  },
  {
    action: 'select_masters',
    description: 'settings.keybinds.actions.select_masters',
    defaultCombo: ['ctrl', 'shift', 'KeyM'],
    section: 'library',
  },
  {
    action: 'select_has_keywords',
    description: 'settings.keybinds.actions.select_has_keywords',
    defaultCombo: ['ctrl', 'alt', 'shift', 'KeyH'],
    section: 'library',
  },
  {
    action: 'select_without_keywords',
    description: 'settings.keybinds.actions.select_without_keywords',
    defaultCombo: ['ctrl', 'alt', 'shift', 'KeyZ'],
    section: 'library',
  },
  {
    action: 'select_has_people',
    description: 'settings.keybinds.actions.select_has_people',
    defaultCombo: ['shift', 'Digit7'],
    section: 'library',
  },
  {
    action: 'select_without_people',
    description: 'settings.keybinds.actions.select_without_people',
    defaultCombo: ['shift', 'Digit8'],
    section: 'library',
  },
  {
    action: 'select_has_event',
    description: 'settings.keybinds.actions.select_has_event',
    defaultCombo: ['shift', 'Digit9'],
    section: 'library',
  },
  {
    action: 'select_without_event',
    description: 'settings.keybinds.actions.select_without_event',
    defaultCombo: ['ctrl', 'Digit2'],
    section: 'library',
  },
  {
    action: 'select_has_scene',
    description: 'settings.keybinds.actions.select_has_scene',
    defaultCombo: ['ctrl', 'Digit3'],
    section: 'library',
  },
  {
    action: 'select_without_scene',
    description: 'settings.keybinds.actions.select_without_scene',
    defaultCombo: ['ctrl', 'Digit4'],
    section: 'library',
  },
  {
    action: 'select_has_genre',
    description: 'settings.keybinds.actions.select_has_genre',
    defaultCombo: ['ctrl', 'Digit5'],
    section: 'library',
  },
  {
    action: 'select_without_genre',
    description: 'settings.keybinds.actions.select_without_genre',
    defaultCombo: ['ctrl', 'Digit6'],
    section: 'library',
  },
  {
    action: 'select_has_subject_code',
    description: 'settings.keybinds.actions.select_has_subject_code',
    defaultCombo: ['ctrl', 'Digit7'],
    section: 'library',
  },
  {
    action: 'select_without_subject_code',
    description: 'settings.keybinds.actions.select_without_subject_code',
    defaultCombo: ['ctrl', 'Digit8'],
    section: 'library',
  },
  {
    action: 'select_has_job_id',
    description: 'settings.keybinds.actions.select_has_job_id',
    defaultCombo: ['ctrl', 'Digit9'],
    section: 'library',
  },
  {
    action: 'select_high_urgency',
    description: 'settings.keybinds.actions.select_high_urgency',
    defaultCombo: ['alt', 'Digit1'],
    section: 'library',
  },
  {
    action: 'select_has_urgency',
    description: 'settings.keybinds.actions.select_has_urgency',
    defaultCombo: ['alt', 'Digit2'],
    section: 'library',
  },
  {
    action: 'select_without_urgency',
    description: 'settings.keybinds.actions.select_without_urgency',
    defaultCombo: ['alt', 'Digit3'],
    section: 'library',
  },
  {
    action: 'select_has_category',
    description: 'settings.keybinds.actions.select_has_category',
    defaultCombo: ['alt', 'Digit4'],
    section: 'library',
  },
  {
    action: 'select_without_category',
    description: 'settings.keybinds.actions.select_without_category',
    defaultCombo: ['alt', 'Digit5'],
    section: 'library',
  },
  {
    action: 'select_without_job_id',
    description: 'settings.keybinds.actions.select_without_job_id',
    defaultCombo: ['alt', 'Digit6'],
    section: 'library',
  },
  {
    action: 'select_has_caption_writer',
    description: 'settings.keybinds.actions.select_has_caption_writer',
    defaultCombo: ['alt', 'Digit7'],
    section: 'library',
  },
  {
    action: 'select_without_caption_writer',
    description: 'settings.keybinds.actions.select_without_caption_writer',
    defaultCombo: ['alt', 'Digit8'],
    section: 'library',
  },
  {
    action: 'select_has_digital_source',
    description: 'settings.keybinds.actions.select_has_digital_source',
    defaultCombo: ['alt', 'Digit9'],
    section: 'library',
  },
  {
    action: 'select_without_digital_source',
    description: 'settings.keybinds.actions.select_without_digital_source',
    defaultCombo: ['alt', 'Digit0'],
    section: 'library',
  },
  {
    action: 'select_has_headline',
    description: 'settings.keybinds.actions.select_has_headline',
    defaultCombo: ['alt', 'KeyH'],
    section: 'library',
  },
  {
    action: 'select_has_title',
    description: 'settings.keybinds.actions.select_has_title',
    defaultCombo: ['alt', 'KeyT'],
    section: 'library',
  },
  {
    action: 'select_has_credit',
    description: 'settings.keybinds.actions.select_has_credit',
    defaultCombo: ['alt', 'KeyY'],
    section: 'library',
  },
  {
    action: 'select_has_source',
    description: 'settings.keybinds.actions.select_has_source',
    defaultCombo: ['alt', 'KeyS'],
    section: 'library',
  },
  {
    action: 'select_has_instructions',
    description: 'settings.keybinds.actions.select_has_instructions',
    defaultCombo: ['alt', 'KeyN'],
    section: 'library',
  },
  {
    action: 'select_has_creator',
    description: 'settings.keybinds.actions.select_has_creator',
    defaultCombo: ['alt', 'KeyC'],
    section: 'library',
  },
  {
    action: 'select_has_rights',
    description: 'settings.keybinds.actions.select_has_rights',
    defaultCombo: ['alt', 'KeyR'],
    section: 'library',
  },
  {
    action: 'select_has_job_title',
    description: 'settings.keybinds.actions.select_has_job_title',
    defaultCombo: ['alt', 'KeyJ'],
    section: 'library',
  },
  {
    action: 'select_has_city',
    description: 'settings.keybinds.actions.select_has_city',
    defaultCombo: ['alt', 'KeyM'],
    section: 'library',
  },
  {
    action: 'select_has_country',
    description: 'settings.keybinds.actions.select_has_country',
    defaultCombo: ['alt', 'KeyO'],
    section: 'library',
  },
  {
    action: 'select_has_state',
    description: 'settings.keybinds.actions.select_has_state',
    defaultCombo: ['alt', 'KeyK'],
    section: 'library',
  },
  {
    action: 'select_has_sublocation',
    description: 'settings.keybinds.actions.select_has_sublocation',
    defaultCombo: ['alt', 'KeyL'],
    section: 'library',
  },
  {
    action: 'select_has_country_code',
    description: 'settings.keybinds.actions.select_has_country_code',
    defaultCombo: ['alt', 'KeyI'],
    section: 'library',
  },
  {
    action: 'select_has_usage_terms',
    description: 'settings.keybinds.actions.select_has_usage_terms',
    defaultCombo: ['alt', 'KeyU'],
    section: 'library',
  },
  {
    action: 'select_without_caption',
    description: 'settings.keybinds.actions.select_without_caption',
    defaultCombo: ['ctrl', 'shift', 'KeyW'],
    section: 'library',
  },
  {
    action: 'select_without_location',
    description: 'settings.keybinds.actions.select_without_location',
    defaultCombo: ['ctrl', 'shift', 'KeyY'],
    section: 'library',
  },
  {
    action: 'select_without_gps',
    description: 'settings.keybinds.actions.select_without_gps',
    defaultCombo: ['ctrl', 'shift', 'KeyK'],
    section: 'library',
  },
  {
    action: 'select_stacked',
    description: 'settings.keybinds.actions.select_stacked',
    defaultCombo: ['ctrl', 'shift', 'KeyA'],
    section: 'library',
  },
  {
    action: 'select_unstacked',
    description: 'settings.keybinds.actions.select_unstacked',
    defaultCombo: ['ctrl', 'shift', 'KeyT'],
    section: 'library',
  },
  {
    action: 'select_same_camera',
    description: 'settings.keybinds.actions.select_same_camera',
    defaultCombo: ['ctrl', 'alt', 'shift', 'KeyM'],
    section: 'library',
  },
  {
    action: 'select_same_lens',
    description: 'settings.keybinds.actions.select_same_lens',
    defaultCombo: ['ctrl', 'alt', 'shift', 'KeyG'],
    section: 'library',
  },
  {
    action: 'select_same_color',
    description: 'settings.keybinds.actions.select_same_color',
    defaultCombo: ['ctrl', 'alt', 'shift', 'KeyB'],
    section: 'library',
  },
  {
    action: 'select_same_day',
    description: 'settings.keybinds.actions.select_same_day',
    defaultCombo: ['ctrl', 'alt', 'shift', 'KeyD'],
    section: 'library',
  },
  {
    action: 'select_same_stack',
    description: 'settings.keybinds.actions.select_same_stack',
    defaultCombo: ['ctrl', 'shift', 'KeyD'],
    section: 'library',
  },
  {
    action: 'select_same_filename_base',
    description: 'settings.keybinds.actions.select_same_filename_base',
    defaultCombo: ['ctrl', 'shift', 'KeyF'],
    section: 'library',
  },
  {
    action: 'cycle_filter_preset',
    description: 'settings.keybinds.actions.cycle_filter_preset',
    defaultCombo: ['ctrl', 'shift', 'KeyQ'],
    section: 'library',
  },
  {
    action: 'select_same_extension',
    description: 'settings.keybinds.actions.select_same_extension',
    defaultCombo: ['ctrl', 'shift', 'KeyZ'],
    section: 'library',
  },
  {
    action: 'select_same_keyword',
    description: 'settings.keybinds.actions.select_same_keyword',
    defaultCombo: ['ctrl', 'alt', 'shift', 'KeyK'],
    section: 'library',
  },
  {
    action: 'select_same_iso',
    description: 'settings.keybinds.actions.select_same_iso',
    defaultCombo: ['ctrl', 'alt', 'shift', 'KeyI'],
    section: 'library',
  },
  {
    action: 'select_same_aperture',
    description: 'settings.keybinds.actions.select_same_aperture',
    defaultCombo: ['ctrl', 'alt', 'shift', 'KeyA'],
    section: 'library',
  },
  {
    action: 'select_same_focal',
    description: 'settings.keybinds.actions.select_same_focal',
    defaultCombo: ['ctrl', 'alt', 'shift', 'KeyL'],
    section: 'library',
  },
  {
    action: 'select_same_shutter',
    description: 'settings.keybinds.actions.select_same_shutter',
    defaultCombo: ['ctrl', 'alt', 'shift', 'KeyT'],
    section: 'library',
  },
  {
    action: 'select_same_city',
    description: 'settings.keybinds.actions.select_same_city',
    defaultCombo: ['ctrl', 'alt', 'shift', 'KeyY'],
    section: 'library',
  },
  {
    action: 'select_same_country',
    description: 'settings.keybinds.actions.select_same_country',
    defaultCombo: ['ctrl', 'alt', 'shift', 'KeyC'],
    section: 'library',
  },
  {
    action: 'select_same_location',
    description: 'settings.keybinds.actions.select_same_location',
    defaultCombo: ['ctrl', 'alt', 'shift', 'KeyO'],
    section: 'library',
  },
  {
    action: 'select_same_folder',
    description: 'settings.keybinds.actions.select_same_folder',
    defaultCombo: ['ctrl', 'alt', 'shift', 'KeyR'],
    section: 'library',
  },
  {
    action: 'stack_photos',
    description: 'settings.keybinds.actions.stack_photos',
    defaultCombo: ['ctrl', 'KeyG'],
    section: 'library',
  },
  {
    action: 'auto_stack_by_time',
    description: 'settings.keybinds.actions.auto_stack_by_time',
    defaultCombo: ['ctrl', 'alt', 'KeyG'],
    section: 'library',
  },
  {
    action: 'select_same_capture_time',
    description: 'settings.keybinds.actions.select_same_capture_time',
    defaultCombo: ['ctrl', 'alt', 'shift', 'Period'],
    section: 'library',
  },
  {
    action: 'unstack_photos',
    description: 'settings.keybinds.actions.unstack_photos',
    defaultCombo: ['ctrl', 'shift', 'KeyG'],
    section: 'library',
  },
  {
    action: 'cycle_stack',
    description: 'settings.keybinds.actions.cycle_stack',
    defaultCombo: ['ctrl', 'KeyS'],
    section: 'library',
  },
  {
    action: 'toggle_expand_stack',
    description: 'settings.keybinds.actions.toggle_expand_stack',
    defaultCombo: ['ctrl', 'alt', 'KeyE'],
    section: 'library',
  },
  {
    action: 'collapse_all_stacks',
    description: 'settings.keybinds.actions.collapse_all_stacks',
    defaultCombo: ['ctrl', 'alt', 'KeyH'],
    section: 'library',
  },
  {
    action: 'toggle_hide_rejected',
    description: 'settings.keybinds.actions.toggle_hide_rejected',
    defaultCombo: ['ctrl', 'alt', 'KeyR'],
    section: 'library',
  },
  {
    action: 'folder_back',
    description: 'settings.keybinds.actions.folder_back',
    defaultCombo: ['alt', 'ArrowLeft'],
    section: 'library',
  },
  {
    action: 'go_to_parent_folder',
    description: 'settings.keybinds.actions.go_to_parent_folder',
    defaultCombo: ['alt', 'ArrowUp'],
    section: 'library',
  },
  {
    action: 'toggle_library_recursive',
    description: 'settings.keybinds.actions.toggle_library_recursive',
    defaultCombo: ['ctrl', 'alt', 'KeyT'],
    section: 'library',
  },
  {
    action: 'folder_forward',
    description: 'settings.keybinds.actions.folder_forward',
    defaultCombo: ['alt', 'ArrowRight'],
    section: 'library',
  },
  {
    action: 'create_collection_from_selection',
    description: 'settings.keybinds.actions.create_collection_from_selection',
    defaultCombo: ['ctrl', 'shift', 'KeyN'],
    section: 'library',
  },
  {
    action: 'delete_rejected',
    description: 'settings.keybinds.actions.delete_rejected',
    defaultCombo: ['ctrl', 'alt', 'shift', 'Backspace'],
    section: 'library',
  },
  {
    action: 'copy_metadata',
    description: 'settings.keybinds.actions.copy_metadata',
    defaultCombo: ['ctrl', 'alt', 'shift', 'KeyJ'],
    section: 'library',
  },
  {
    action: 'paste_metadata',
    description: 'settings.keybinds.actions.paste_metadata',
    defaultCombo: ['ctrl', 'alt', 'shift', 'KeyQ'],
    section: 'library',
  },
  {
    action: 'go_to_folder',
    description: 'settings.keybinds.actions.go_to_folder',
    defaultCombo: ['ctrl', 'alt', 'shift', 'KeyF'],
    section: 'library',
  },
  {
    action: 'color_label_none',
    description: 'settings.keybinds.actions.color_label_none',
    defaultCombo: ['shift', 'Digit0'],
    section: 'rating',
  },
  {
    action: 'color_label_red',
    description: 'settings.keybinds.actions.color_label_red',
    defaultCombo: ['Digit6'],
    section: 'rating',
  },
  {
    action: 'color_label_yellow',
    description: 'settings.keybinds.actions.color_label_yellow',
    defaultCombo: ['Digit7'],
    section: 'rating',
  },
  {
    action: 'color_label_green',
    description: 'settings.keybinds.actions.color_label_green',
    defaultCombo: ['Digit8'],
    section: 'rating',
  },
  {
    action: 'color_label_blue',
    description: 'settings.keybinds.actions.color_label_blue',
    defaultCombo: ['Digit9'],
    section: 'rating',
  },
  {
    action: 'color_label_purple',
    description: 'settings.keybinds.actions.color_label_purple',
    defaultCombo: ['shift', 'Digit6'],
    section: 'rating',
  },
  {
    action: 'cycle_color_label',
    description: 'settings.keybinds.actions.cycle_color_label',
    defaultCombo: ['Quote'],
    section: 'rating',
  },
  {
    action: 'toggle_previous_import',
    description: 'settings.keybinds.actions.toggle_previous_import',
    defaultCombo: ['ctrl', 'alt', 'KeyN'],
    section: 'library',
  },
  {
    action: 'toggle_adjustments',
    description: 'settings.keybinds.actions.toggle_adjustments',
    defaultCombo: ['KeyD'],
    section: 'panels',
  },
  {
    action: 'toggle_crop_panel',
    description: 'settings.keybinds.actions.toggle_crop_panel',
    defaultCombo: ['KeyR'],
    section: 'panels',
  },
  {
    action: 'toggle_wb_picker',
    description: 'settings.keybinds.actions.toggle_wb_picker',
    defaultCombo: ['KeyW'],
    section: 'editing',
  },
  {
    action: 'cycle_white_balance',
    description: 'settings.keybinds.actions.cycle_white_balance',
    defaultCombo: ['shift', 'KeyW'],
    section: 'editing',
  },
  {
    action: 'toggle_masks',
    description: 'settings.keybinds.actions.toggle_masks',
    defaultCombo: ['KeyM'],
    section: 'panels',
  },
  {
    action: 'toggle_ai',
    description: 'settings.keybinds.actions.toggle_ai',
    defaultCombo: ['KeyK'],
    section: 'panels',
  },
  {
    action: 'toggle_presets',
    description: 'settings.keybinds.actions.toggle_presets',
    defaultCombo: ['KeyY'],
    section: 'panels',
  },
  {
    action: 'cycle_develop_info',
    description: 'settings.keybinds.actions.cycle_develop_info',
    defaultCombo: ['KeyI'],
    section: 'panels',
  },
  {
    action: 'toggle_grid_filenames',
    description: 'settings.keybinds.actions.toggle_grid_filenames',
    defaultCombo: ['ctrl', 'shift', 'KeyJ'],
    section: 'library',
  },
  {
    action: 'toggle_metadata',
    description: 'settings.keybinds.actions.toggle_metadata',
    defaultCombo: ['ctrl', 'KeyI'],
    section: 'panels',
  },
  {
    action: 'toggle_analytics',
    description: 'settings.keybinds.actions.toggle_analytics',
    defaultCombo: ['KeyA'],
    section: 'panels',
  },
  {
    action: 'export_previous',
    description: 'settings.keybinds.actions.export_previous',
    defaultCombo: ['ctrl', 'alt', 'shift', 'KeyW'],
    section: 'panels',
  },
  {
    action: 'toggle_export',
    description: 'settings.keybinds.actions.toggle_export',
    defaultCombo: ['KeyE'],
    section: 'panels',
  },
  {
    action: 'toggle_library_exif',
    description: 'settings.keybinds.actions.toggle_library_exif',
    defaultCombo: ['KeyT'],
    section: 'library',
  },
  {
    action: 'open_settings',
    description: 'settings.keybinds.actions.open_settings',
    defaultCombo: ['ctrl', 'Comma'],
    section: 'library',
  },
  {
    action: 'focus_search',
    description: 'settings.keybinds.actions.focus_search',
    defaultCombo: ['ctrl', 'KeyF'],
    section: 'library',
  },
  { action: 'undo', description: 'settings.keybinds.actions.undo', defaultCombo: ['ctrl', 'KeyZ'], section: 'editing' },
  { action: 'redo', description: 'settings.keybinds.actions.redo', defaultCombo: ['ctrl', 'KeyY'], section: 'editing' },
  {
    action: 'history_step_back',
    description: 'settings.keybinds.actions.history_step_back',
    defaultCombo: ['ctrl', 'alt', 'ArrowLeft'],
    section: 'editing',
  },
  {
    action: 'history_step_forward',
    description: 'settings.keybinds.actions.history_step_forward',
    defaultCombo: ['ctrl', 'alt', 'ArrowRight'],
    section: 'editing',
  },
  {
    action: 'clear_history',
    description: 'settings.keybinds.actions.clear_history',
    defaultCombo: ['ctrl', 'shift', 'KeyH'],
    section: 'editing',
  },
  {
    action: 'expand_all_sections',
    description: 'settings.keybinds.actions.expand_all_sections',
    defaultCombo: ['ctrl', 'shift', 'Period'],
    section: 'editing',
  },
  {
    action: 'collapse_all_sections',
    description: 'settings.keybinds.actions.collapse_all_sections',
    defaultCombo: ['ctrl', 'shift', 'Comma'],
    section: 'editing',
  },
  {
    action: 'before_after_split',
    description: 'settings.keybinds.actions.before_after_split',
    defaultCombo: ['Backslash'],
    section: 'editing',
  },
  {
    action: 'soft_proof',
    description: 'settings.keybinds.actions.soft_proof',
    defaultCombo: ['ctrl', 'shift', 'KeyP'],
    section: 'editing',
  },
  {
    action: 'cycle_soft_proof_profile',
    description: 'settings.keybinds.actions.cycle_soft_proof_profile',
    defaultCombo: ['ctrl', 'shift', 'BracketRight'],
    section: 'editing',
  },
  {
    action: 'cycle_soft_proof_profile_prev',
    description: 'settings.keybinds.actions.cycle_soft_proof_profile_prev',
    defaultCombo: ['ctrl', 'shift', 'BracketLeft'],
    section: 'editing',
  },
  {
    action: 'cycle_soft_proof_intent',
    description: 'settings.keybinds.actions.cycle_soft_proof_intent',
    defaultCombo: ['ctrl', 'shift', 'Semicolon'],
    section: 'editing',
  },
  {
    action: 'toggle_soft_proof_paper',
    description: 'settings.keybinds.actions.toggle_soft_proof_paper',
    defaultCombo: ['ctrl', 'shift', 'KeyO'],
    section: 'editing',
  },
  {
    action: 'create_proof_copy',
    description: 'settings.keybinds.actions.create_proof_copy',
    defaultCombo: ['ctrl', 'alt', 'shift', 'KeyS'],
    section: 'editing',
  },
  {
    action: 'toggle_soft_proof_gamut',
    description: 'settings.keybinds.actions.toggle_soft_proof_gamut',
    defaultCombo: ['ctrl', 'shift', 'KeyG'],
    section: 'editing',
  },


  {
    action: 'copy_adjustments',
    description: 'settings.keybinds.actions.copy_adjustments',
    defaultCombo: ['ctrl', 'KeyC'],
    section: 'editing',
  },
  {
    action: 'paste_adjustments',
    description: 'settings.keybinds.actions.paste_adjustments',
    defaultCombo: ['ctrl', 'KeyV'],
    section: 'editing',
  },
  {
    action: 'match_previous',
    description: 'settings.keybinds.actions.match_previous',
    defaultCombo: ['ctrl', 'alt', 'KeyP'],
    section: 'editing',
  },
  {
    action: 'sync_settings',
    description: 'settings.keybinds.actions.sync_settings',
    defaultCombo: ['ctrl', 'alt', 'KeyS'],
    section: 'editing',
  },
  {
    action: 'rotate_left',
    description: 'settings.keybinds.actions.rotate_left',
    defaultCombo: ['BracketLeft'],
    section: 'editing',
  },
  {
    action: 'rotate_right',
    description: 'settings.keybinds.actions.rotate_right',
    defaultCombo: ['BracketRight'],
    section: 'editing',
  },
  {
    action: 'flip_horizontal',
    description: 'settings.keybinds.actions.flip_horizontal',
    defaultCombo: ['KeyH'],
    section: 'editing',
  },
  {
    action: 'flip_vertical',
    description: 'settings.keybinds.actions.flip_vertical',
    defaultCombo: ['KeyV'],
    section: 'editing',
  },
  {
    action: 'toggle_crop',
    description: 'settings.keybinds.actions.toggle_crop',
    defaultCombo: ['KeyS'],
    section: 'editing',
  },
  {
    action: 'toggle_straighten',
    description: 'settings.keybinds.actions.toggle_straighten',
    defaultCombo: ['KeyQ'],
    section: 'editing',
  },
  {
    action: 'brush_size_up',
    description: 'settings.keybinds.actions.brush_size_up',
    defaultCombo: ['ctrl', 'ArrowUp'],
    section: 'editing',
  },
  {
    action: 'brush_size_down',
    description: 'settings.keybinds.actions.brush_size_down',
    defaultCombo: ['ctrl', 'ArrowDown'],
    section: 'editing',
  },
  {
    action: 'brush_feather_up',
    description: 'settings.keybinds.actions.brush_feather_up',
    defaultCombo: ['ctrl', 'shift', 'ArrowUp'],
    section: 'editing',
  },
  {
    action: 'brush_feather_down',
    description: 'settings.keybinds.actions.brush_feather_down',
    defaultCombo: ['ctrl', 'shift', 'ArrowDown'],
    section: 'editing',
  },
];

const symMap: Record<string, string> = {
  Space: 'Space',
  Backspace: '⌫',
  Enter: 'Enter',
  Delete: 'Delete',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  BracketLeft: '[',
  BracketRight: ']',
  Minus: '-',
  Equal: '+',
  Comma: ',',
  Period: '.',
  Slash: '/',
  Semicolon: ';',
  Quote: "'",
  Backquote: '`',
  Backslash: '\\',
  Tab: 'Tab',
  Escape: 'Esc',
  PageUp: 'Page Up',
  PageDown: 'Page Down',
  Home: 'Home',
  End: 'End',
  Insert: 'Insert',
  NumpadAdd: 'Numpad +',
  NumpadMultiply: 'Numpad *',
  NumpadDivide: 'Numpad /',
  NumpadSubtract: 'Numpad -',
  NumpadDecimal: 'Numpad .',
  NumpadComma: 'Numpad ,',
  NumpadEnter: 'Numpad Enter',
  NumpadEqual: 'Numpad =',
  CapsLock: 'Caps Lock',
  PrintScreen: 'PrtSc',
};

export function normalizeCombo(event: KeyboardEvent, osPlatform?: string): string[] {
  const isMacDelete = osPlatform === 'macos' && event.code === 'Backspace' && (event.ctrlKey || event.metaKey);
  const parts: string[] = [];
  if ((event.ctrlKey || event.metaKey) && !isMacDelete) parts.push('ctrl');
  if (event.shiftKey) parts.push('shift');
  if (event.altKey) parts.push('alt');
  let code = isMacDelete ? 'Delete' : event.code;
  if (event.key && /^[a-zA-Z]$/.test(event.key)) {
    code = `Key${event.key.toUpperCase()}`;
  } else if (/^Numpad[0-9]$/.test(code)) {
    code = `Digit${code.slice(-1)}`;
  } else if (code === 'NumpadAdd') {
    code = 'Equal';
  } else if (code === 'NumpadSubtract') {
    code = 'Minus';
  }
  if (isValidShortcutKey(code)) {
    parts.push(code);
  }
  return parts;
}

export function codeToDisplayLabel(code: string): string | null {
  if (/^Key[A-Z]$/.test(code) || /^Digit[0-9]$/.test(code)) {
    return code[code.length - 1].toUpperCase();
  }
  if (/^Numpad[0-9]$/.test(code)) {
    return `Numpad ${code.slice(-1)}`;
  }
  return symMap[code] ?? null;
}

export function isValidShortcutKey(code: string): boolean {
  if (code.startsWith('Key') || code.startsWith('Digit')) return true;
  if (code.startsWith('F') && /^\d+$/.test(code.slice(1))) return true;
  if (/^Numpad[0-9]$/.test(code)) return true;
  return code in symMap;
}

export function formatKeyCode(key: string, osPlatform: string): string {
  if (key === 'ctrl') return osPlatform === 'macos' ? '⌘' : 'Ctrl';
  if (key === 'shift') return 'Shift';
  if (key === 'alt') return osPlatform === 'macos' ? '⌥' : 'Alt';
  if (key === 'Delete' && osPlatform === 'macos') return 'Delete / ⌘+⌫';
  const label = codeToDisplayLabel(key);
  return label || key;
}

export function arraysEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}
