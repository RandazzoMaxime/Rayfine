import React, { useCallback, useEffect } from 'react';
import { Eye, RotateCcw, Copy, ClipboardPaste, Aperture } from 'lucide-react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import BasicAdjustments from '../../adjustments/Basic';
import CurveGraph from '../../adjustments/Curves';
import ColorPanel, { ColorCalibrationPanel, ColorGradingPanel } from '../../adjustments/Color';
import DetailsPanel from '../../adjustments/Details';
import EffectsPanel from '../../adjustments/Effects';
import LensPanel from '../../adjustments/Lens';
import TransformPanel from '../../adjustments/Transform';
import AnamorphicPanel from '../../adjustments/Anamorphic';
import CollapsibleSection from '../../ui/CollapsibleSection';
import ProfileExplorer from './ProfileExplorer';
import {
  Adjustments,
  SectionVisibility,
  INITIAL_ADJUSTMENTS,
  ADJUSTMENT_SECTIONS,
  detectedCameraProfileFor,
} from '../../../utils/adjustments';
import { useContextMenu } from '../../../context/ContextMenuContext';
import { OPTION_SEPARATOR } from '../../ui/AppProperties';
import { useShallow } from 'zustand/react/shallow';
import { useEditorStore } from '../../../store/useEditorStore';
import { useSettingsStore } from '../../../store/useSettingsStore';
import { useUIStore } from '../../../store/useUIStore';
import { useEditorActions } from '../../../hooks/useEditorActions';


// Collapsed sections stay mounted (for the height transition) but are invisible:
// skip their re-render on every adjustment frame until they are opened again.
const FrozenWhenClosed = React.memo(
  ({ children }: { open: boolean; children: React.ReactNode }) => <>{children}</>,
  (prev, next) => !prev.open && !next.open,
);

export default function Controls() {
  const { t } = useTranslation();
  const { showContextMenu } = useContextMenu();
  const { setAdjustments, handleAutoAdjustments, handleLutSelect, setLutPreviewOverride } = useEditorActions();

  const { appSettings, theme } = useSettingsStore(
    useShallow((state) => ({
      appSettings: state.appSettings,
      theme: state.theme,
    })),
  );

  const { collapsibleSectionsState, isProfileBrowserOpen, setUI } = useUIStore(
    useShallow((state) => ({
      collapsibleSectionsState: state.collapsibleSectionsState,
      isProfileBrowserOpen: state.isProfileBrowserOpen,
      setUI: state.setUI,
    })),
  );

  const {
    adjustments,
    copiedSectionAdjustments,
    selectedImage,
    isWbPickerActive,
    setEditor,
  } = useEditorStore(
    useShallow((state) => ({
      adjustments: state.adjustments,
      copiedSectionAdjustments: state.copiedSectionAdjustments,
      selectedImage: state.selectedImage,
      isWbPickerActive: state.isWbPickerActive,
      setEditor: state.setEditor,
    })),
  );

  const setCopiedSectionAdjustments = useCallback(
    (val: any) => setEditor({ copiedSectionAdjustments: val }),
    [setEditor],
  );

  const toggleWbPicker = useCallback(
    () =>
      setEditor((state) => ({
        isWbPickerActive: !state.isWbPickerActive,
        isPointColorPickerActive: false,
      })),
    [setEditor],
  );

  const onDragStateChange = useCallback(
    (isDragging: boolean) => setEditor({ isSliderDragging: isDragging }),
    [setEditor],
  );

  const setCollapsibleState = useCallback(
    (updater: any) =>
      setUI((state) => ({
        collapsibleSectionsState: typeof updater === 'function' ? updater(state.collapsibleSectionsState) : updater,
      })),
    [setUI],
  );

  const handleToggleVisibility = (sectionName: string) => {
    setAdjustments((prev: Adjustments) => {
      const currentVisibility: SectionVisibility = prev.sectionVisibility || INITIAL_ADJUSTMENTS.sectionVisibility;
      return {
        ...prev,
        sectionVisibility: {
          ...currentVisibility,
          [sectionName]: !currentVisibility[sectionName],
        },
      };
    });
  };

  const handleToggleSection = (section: string, evt?: { altKey?: boolean; metaKey?: boolean }) => {
    setCollapsibleState((prev: any) => {
      const isOpening = !prev[section];
      // LR-style Solo: Alt/Option-click opens only this section (or settings focus mode)
      const solo = !!(evt?.altKey || evt?.metaKey) || (!!appSettings?.enableFocusMode && isOpening);
      if (solo && isOpening) {
        const newState: any = { ...prev };
        Object.keys(newState).forEach((key) => {
          newState[key] = false;
        });
        newState[section] = true;
        return newState;
      }
      return { ...prev, [section]: !prev[section] };
    });
  };

  const handleSoloSection = (section: string) => {
    setCollapsibleState((prev: any) => {
      const newState: any = { ...prev };
      Object.keys(newState).forEach((key) => {
        newState[key] = false;
      });
      newState[section] = true;
      return newState;
    });
  };

  const DEVELOP_SECTIONS = [
    'basic',
    'curves',
    'color',
    'colorGrading',
    'details',
    'optics',
    'geometry',
    'lensBlur',
    'effects',
    'calibration',
    'anamorphic',
  ] as const;

  const handleExpandAllSections = () => {
    setCollapsibleState((prev: any) => {
      const newState: any = { ...prev };
      for (const s of DEVELOP_SECTIONS) newState[s] = true;
      return newState;
    });
  };

  const handleCollapseAllSections = () => {
    setCollapsibleState((prev: any) => {
      const newState: any = { ...prev };
      for (const s of DEVELOP_SECTIONS) newState[s] = false;
      return newState;
    });
  };

  useEffect(() => {
    const onExpand = () => handleExpandAllSections();
    const onCollapse = () => handleCollapseAllSections();
    window.addEventListener('rustroom:expand-all-sections', onExpand as EventListener);
    window.addEventListener('rustroom:collapse-all-sections', onCollapse as EventListener);
    return () => {
      window.removeEventListener('rustroom:expand-all-sections', onExpand as EventListener);
      window.removeEventListener('rustroom:collapse-all-sections', onCollapse as EventListener);
    };
  }, []);

  const handleSectionContextMenu = (event: any, sectionName: string) => {
    event.preventDefault();
    event.stopPropagation();

    const sectionKeys = ADJUSTMENT_SECTIONS[sectionName as keyof typeof ADJUSTMENT_SECTIONS];
    if (!sectionKeys) {
      return;
    }

    const handleCopy = () => {
      const adjustmentsToCopy: any = {};
      for (const key of sectionKeys) {
        if (Object.prototype.hasOwnProperty.call(adjustments, key)) {
          adjustmentsToCopy[key] = JSON.parse(JSON.stringify(adjustments[key as keyof Adjustments]));
        }
      }
      setCopiedSectionAdjustments({ section: sectionName, values: adjustmentsToCopy });
    };

    const handlePaste = () => {
      if (!copiedSectionAdjustments || copiedSectionAdjustments.section !== sectionName) {
        return;
      }
      setAdjustments((prev: Adjustments) => ({
        ...prev,
        ...copiedSectionAdjustments.values,
        sectionVisibility: {
          ...(prev.sectionVisibility || INITIAL_ADJUSTMENTS.sectionVisibility),
          [sectionName]: true,
        },
      }));
    };

    const handleReset = () => {
      const resetValues: any = {};
      for (const key of sectionKeys) {
        resetValues[key] = JSON.parse(JSON.stringify(INITIAL_ADJUSTMENTS[key as keyof Adjustments]));
      }
      setAdjustments((prev: Adjustments) => ({
        ...prev,
        ...resetValues,
        sectionVisibility: {
          ...(prev.sectionVisibility || INITIAL_ADJUSTMENTS.sectionVisibility),
          [sectionName]: true,
        },
      }));
    };

    const isPasteAllowed = copiedSectionAdjustments && copiedSectionAdjustments.section === sectionName;
    const translatedSection = t(`editor.adjustments.sections.${sectionName}`);

    const pasteLabel = copiedSectionAdjustments
      ? t('editor.adjustments.actions.pasteLabel', { section: translatedSection })
      : t('editor.adjustments.actions.pasteSettings');

    const options: any = [
      {
        label: t('editor.adjustments.actions.copySectionSettings', { section: translatedSection }),
        icon: Copy,
        onClick: handleCopy,
      },
      { label: pasteLabel, icon: ClipboardPaste, onClick: handlePaste, disabled: !isPasteAllowed },
      { type: OPTION_SEPARATOR },
      {
        label: t('editor.adjustments.actions.soloSection' as any, {
          defaultValue: 'Solo mode',
          section: translatedSection,
        }),
        icon: Eye,
        onClick: () => handleSoloSection(sectionName),
      },
      {
        label: t('editor.adjustments.actions.resetSectionSettings', { section: translatedSection }),
        icon: RotateCcw,
        onClick: handleReset,
      },
    ];

    showContextMenu(event.clientX, event.clientY, options);
  };

  if (isProfileBrowserOpen) {
    return <ProfileExplorer />;
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-2 py-1 flex justify-between items-center shrink-0">
        <span className="text-[11px] font-medium text-text-primary tracking-wide">
          {t('editor.adjustments.title')}
        </span>
        <button
          className={clsx(
            'p-1 rounded-full hover:bg-surface disabled:cursor-not-allowed transition-colors',
            (adjustments as any).autoTone && 'bg-accent/20 text-accent',
          )}
          disabled={!selectedImage?.isReady}
          onClick={handleAutoAdjustments}
          data-tooltip={
            (adjustments as any).autoTone
              ? t('editor.adjustments.tooltips.autoAdjustActive' as any, {
                  defaultValue: 'Auto applied (AutoTone)',
                })
              : t('editor.adjustments.tooltips.autoAdjust')
          }
        >
          <Aperture size={14} />
        </button>
      </div>

      <div className="grow overflow-y-scroll px-0 py-0 flex flex-col custom-scrollbar">
        {DEVELOP_SECTIONS.map((sectionName) => {
          const SectionComponent: any = {
            basic: BasicAdjustments,
            color: ColorPanel,
            colorGrading: ColorGradingPanel,
            curves: CurveGraph,
            details: DetailsPanel,
            effects: EffectsPanel,
            optics: LensPanel,
            geometry: TransformPanel,
            lensBlur: EffectsPanel,
            calibration: ColorCalibrationPanel,
            anamorphic: AnamorphicPanel,
          }[sectionName];

          const title = t(`editor.adjustments.sections.${sectionName}`);
          const sectionVisibility = adjustments.sectionVisibility || INITIAL_ADJUSTMENTS.sectionVisibility;
          const extraProps =
            sectionName === 'basic'
              ? (() => {
                  const profile = detectedCameraProfileFor(selectedImage?.exif as any, !!selectedImage?.isRaw);
                  return profile ? { detectedCameraProfile: profile } : {};
                })()
              : sectionName === 'color'
              ? { panel: 'mixer' as const }
              : sectionName === 'colorGrading'
                ? { panel: 'grading' as const }
                : sectionName === 'lensBlur'
                  ? { variant: 'lensBlur' as const }
                  : sectionName === 'effects'
                    ? { variant: 'effects' as const }
                    : {};

          const isOpen = !!collapsibleSectionsState[sectionName as keyof typeof collapsibleSectionsState];

          return (
            <div className="shrink-0 group" key={sectionName}>
              <CollapsibleSection
                isContentVisible={sectionVisibility[sectionName as keyof SectionVisibility] !== false}
                isOpen={isOpen}
                onContextMenu={(e: any) => handleSectionContextMenu(e, sectionName)}
                onToggle={(e?: any) => handleToggleSection(sectionName, e)}
                onToggleVisibility={() => handleToggleVisibility(sectionName)}
                title={title}
              >
                <FrozenWhenClosed open={isOpen}>
                <SectionComponent
                  adjustments={adjustments}
                  setAdjustments={setAdjustments}
                  theme={theme}
                  handleLutSelect={handleLutSelect}
                  onLutHover={setLutPreviewOverride}
                  appSettings={appSettings}
                  isWbPickerActive={isWbPickerActive}
                  toggleWbPicker={toggleWbPicker}
                  onDragStateChange={onDragStateChange}
                  {...extraProps}
                />
                </FrozenWhenClosed>
              </CollapsibleSection>
            </div>
          );
        })}
      </div>
    </div>
  );
}
