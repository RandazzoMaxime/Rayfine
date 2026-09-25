import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Text from '../ui/Text';
import { TextVariants } from '../../types/typography';
import { PRESET_SECTIONS } from '../../utils/presetTree';

const NEW_GROUP = '__new__';

export interface CreatePresetResult {
  name: string;
  groupId: string | null;
  newGroupName: string | null;
  sections: Set<string>;
}

interface CreatePresetModalProps {
  isOpen: boolean;
  groups: Array<{ id: string; name: string }>;
  defaultGroupId: string | null;
  onClose(): void;
  onSave(result: CreatePresetResult): void;
}

/** Lightroom-style "New Develop Preset" dialog: name, group, settings to include. */
export default function CreatePresetModal({ isOpen, groups, defaultGroupId, onClose, onSave }: CreatePresetModalProps) {
  const { t } = useTranslation();
  const [isMounted, setIsMounted] = useState(false);
  const [show, setShow] = useState(false);
  const [name, setName] = useState('');
  const [groupId, setGroupId] = useState<string>('');
  const [newGroupName, setNewGroupName] = useState('');
  const [sections, setSections] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (isOpen) {
      setName('');
      setNewGroupName('');
      setGroupId(defaultGroupId || groups[0]?.id || NEW_GROUP);
      setSections(new Set(PRESET_SECTIONS.filter((s) => s.defaultOn).map((s) => s.id)));
      setIsMounted(true);
      const timer = setTimeout(() => setShow(true), 10);
      return () => clearTimeout(timer);
    }
    setShow(false);
    const timer = setTimeout(() => setIsMounted(false), 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const isNewGroup = groupId === NEW_GROUP;
  const canSave = !!name.trim() && (!isNewGroup || !!newGroupName.trim()) && sections.size > 0;

  const handleSave = useCallback(() => {
    if (!canSave) return;
    onSave({
      name: name.trim(),
      groupId: isNewGroup ? null : groupId,
      newGroupName: isNewGroup ? newGroupName.trim() : null,
      sections,
    });
  }, [canSave, onSave, name, isNewGroup, groupId, newGroupName, sections]);

  const toggle = (id: string) =>
    setSections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  if (!isMounted) return null;

  return (
    <div
      aria-modal="true"
      role="dialog"
      className={`fixed inset-0 flex items-center justify-center z-50 bg-black/30 backdrop-blur-xs transition-opacity duration-300 ease-in-out ${
        show ? 'opacity-100' : 'opacity-0'
      }`}
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          e.nativeEvent.stopImmediatePropagation();
          onClose();
        } else if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') {
          e.preventDefault();
          e.stopPropagation();
          e.nativeEvent.stopImmediatePropagation();
          handleSave();
        }
      }}
    >
      <div
        className={`bg-surface rounded-lg shadow-xl p-5 w-full max-w-md transform transition-all duration-300 ease-out ${
          show ? 'scale-100 opacity-100 translate-y-0' : 'scale-95 opacity-0 -translate-y-4'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <Text variant={TextVariants.title} className="mb-4">
          {t('ui.developLeft.newPresetTitle' as any, { defaultValue: 'New Develop Preset' })}
        </Text>

        <label className="block text-[11px] text-text-secondary mb-1">
          {t('ui.developLeft.presetName' as any, { defaultValue: 'Preset name' })}
        </label>
        <input
          autoFocus
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('ui.developLeft.presetNamePlaceholder' as any, { defaultValue: 'Untitled Preset' })}
          className="w-full bg-bg-primary text-text-primary border border-border-color rounded-md px-3 py-1.5 text-sm focus:outline-hidden focus:ring-2 focus:ring-accent"
        />

        <label className="block text-[11px] text-text-secondary mt-3 mb-1">
          {t('ui.developLeft.presetGroup' as any, { defaultValue: 'Group' })}
        </label>
        <div className="flex gap-2">
          <select
            value={groupId}
            onChange={(e) => setGroupId(e.target.value)}
            className="flex-1 min-w-0 bg-bg-primary text-text-primary border border-border-color rounded-md px-2 py-1.5 text-sm"
          >
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
            <option value={NEW_GROUP}>{t('ui.developLeft.newGroupOption' as any, { defaultValue: 'New group…' })}</option>
          </select>
          {isNewGroup && (
            <input
              type="text"
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              placeholder={t('ui.developLeft.groupName' as any, { defaultValue: 'Group name' })}
              className="flex-1 min-w-0 bg-bg-primary text-text-primary border border-border-color rounded-md px-2 py-1.5 text-sm focus:outline-hidden focus:ring-2 focus:ring-accent"
            />
          )}
        </div>

        <div className="flex items-center justify-between mt-4 mb-1.5">
          <span className="text-[11px] text-text-secondary">
            {t('ui.developLeft.settingsToInclude' as any, { defaultValue: 'Settings to include' })}
          </span>
          <span className="flex gap-2 text-[11px]">
            <button
              type="button"
              className="text-accent hover:underline"
              onClick={() => setSections(new Set(PRESET_SECTIONS.map((s) => s.id)))}
            >
              {t('ui.developLeft.checkAll' as any, { defaultValue: 'Check All' })}
            </button>
            <button type="button" className="text-accent hover:underline" onClick={() => setSections(new Set())}>
              {t('ui.developLeft.checkNone' as any, { defaultValue: 'Check None' })}
            </button>
          </span>
        </div>
        <div className="grid grid-cols-2 gap-x-3 gap-y-1 bg-bg-primary rounded-md p-2.5 border border-border-color/40">
          {PRESET_SECTIONS.map((s) => (
            <label key={s.id} className="flex items-center gap-2 text-[12px] text-text-primary cursor-pointer select-none">
              <input type="checkbox" checked={sections.has(s.id)} onChange={() => toggle(s.id)} className="accent-accent" />
              {t(`ui.developLeft.presetSection.${s.id}` as any, { defaultValue: s.label })}
            </label>
          ))}
        </div>

        <div className="flex justify-end gap-3 mt-5">
          <button
            type="button"
            className="px-4 py-2 rounded-md text-text-secondary hover:bg-bg-primary transition-colors"
            onClick={onClose}
          >
            {t('modals.renameFolder.cancel')}
          </button>
          <button
            type="button"
            className="px-4 py-2 rounded-md bg-accent text-button-text font-semibold hover:bg-accent-hover disabled:bg-gray-500 disabled:text-white disabled:cursor-not-allowed transition-colors"
            disabled={!canSave}
            onClick={handleSave}
          >
            {t('ui.developLeft.createPreset' as any, { defaultValue: 'Create' })}
          </button>
        </div>
      </div>
    </div>
  );
}
