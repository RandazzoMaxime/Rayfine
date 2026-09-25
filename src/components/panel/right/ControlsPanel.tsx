import React, { useCallback, useEffect } from 'react';
import {
  Eye, RotateCcw, Copy, ClipboardPaste, Aperture, ChevronsDown, ChevronsUp } from 'lucide-react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import BasicAdjustments from '../../adjustments/Basic';
import CurveGraph from '../../adjustments/Curves';
import ColorPanel, { ColorCalibrationPanel } from '../../adjustments/Color';
import DetailsPanel from '../../adjustments/Details';
import EffectsPanel from '../../adjustments/Effects';
import LensPanel from '../../adjustments/Lens';
import TransformPanel from '../../adjustments/Transform';
import CollapsibleSection from '../../ui/CollapsibleSection';
import { Adjustments, SectionVisibility, INITIAL_ADJUSTMENTS, ADJUSTMENT_SECTIONS } from '../../../utils/adjustments';
import { useContextMenu } from '../../../context/ContextMenuContext';
import { OPTION_SEPARATOR } from '../../ui/AppProperties';
import Text from '../../ui/Text';
import { TextVariants } from '../../../types/typography';
import { useShallow } from 'zustand/react/shallow';
import { useEditorStore } from '../../../store/useEditorStore';
import { useSettingsStore } from '../../../store/useSettingsStore';
import { useUIStore } from '../../../store/useUIStore';
import { useEditorActions } from '../../../hooks/useEditorActions';


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

  const { collapsibleSectionsState, setUI } = useUIStore(
    useShallow((state) => ({
      collapsibleSectionsState: state.collapsibleSectionsState,
      setUI: state.setUI,
    })),
  );

  const {
    adjustments,
    copiedSectionAdjustments,
    histogram,
    selectedImage,
    isWbPickerActive,
    setEditor,
  } = useEditorStore(
    useShallow((state) => ({
      adjustments: state.adjustments,
      copiedSectionAdjustments: state.copiedSectionAdjustments,
      histogram: state.histogram,
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

  const handleResetAdjustments = () => {
    setAdjustments((prev: Adjustments) => ({
      ...prev,
      ...Object.keys(ADJUSTMENT_SECTIONS)
        .flatMap((s) => ADJUSTMENT_SECTIONS[s])
        .reduce((acc: any, key: string) => {
          acc[key] = INITIAL_ADJUSTMENTS[key as keyof Adjustments];
          return acc;
        }, {}),
      sectionVisibility: { ...INITIAL_ADJUSTMENTS.sectionVisibility },
    }));
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
    'details',
    'optics',
    'geometry',
    'effects',
    'calibration',
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

    const sectionKeys = ADJUSTMENT_SECTIONS[sectionName];
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

  return (
    <div className="flex flex-col h-full">
      <div className="px-2.5 py-1.5 flex justify-between items-center shrink-0 border-b border-border-color/40">
        <Text variant={TextVariants.title}>{t('editor.adjustments.title')}</Text>
        <div className="flex items-center gap-1">
          <button
            className={clsx(
              'p-1.5 rounded-full hover:bg-surface disabled:cursor-not-allowed transition-colors',
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
            <Aperture size={16} />
          </button>
          <button
            type="button"
            className="p-1.5 rounded-full hover:bg-surface transition-colors"
            onClick={handleExpandAllSections}
            data-tooltip={t('editor.adjustments.tooltips.expandAll' as any, {
              defaultValue: 'Expand all panels',
            })}
          >
            <ChevronsDown size={16} />
          </button>
          <button
            type="button"
            className="p-1.5 rounded-full hover:bg-surface transition-colors"
            onClick={handleCollapseAllSections}
            data-tooltip={t('editor.adjustments.tooltips.collapseAll' as any, {
              defaultValue: 'Collapse all panels',
            })}
          >
            <ChevronsUp size={16} />
          </button>
          <button
            className="p-1.5 rounded-full hover:bg-surface disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            disabled={!selectedImage}
            onClick={handleResetAdjustments}
            data-tooltip={t('editor.adjustments.tooltips.resetAdjustments')}
          >
            <RotateCcw size={16} />
          </button>
        </div>
      </div>

      <div className="grow overflow-y-scroll px-2.5 py-1.5 flex flex-col gap-0.5 custom-scrollbar">
        {(['basic', 'curves', 'color', 'details', 'optics', 'geometry', 'effects', 'calibration'] as const).map((sectionName) => {
          const SectionComponent: any = {
            basic: BasicAdjustments,
            color: ColorPanel,
            curves: CurveGraph,
            details: DetailsPanel,
            effects: EffectsPanel,
            optics: LensPanel,
            geometry: TransformPanel,
            calibration: ColorCalibrationPanel,
          }[sectionName];

          const title = t(`editor.adjustments.sections.${sectionName}`);
          const sectionVisibility = adjustments.sectionVisibility || INITIAL_ADJUSTMENTS.sectionVisibility;

          return (
            <div className="shrink-0 group" key={sectionName}>
              <CollapsibleSection
                isContentVisible={sectionVisibility[sectionName as keyof SectionVisibility] !== false}
                isOpen={!!collapsibleSectionsState[sectionName as keyof typeof collapsibleSectionsState]}
                onContextMenu={(e: any) => handleSectionContextMenu(e, sectionName)}
                onToggle={(e?: any) => handleToggleSection(sectionName, e)}
                onToggleVisibility={() => handleToggleVisibility(sectionName)}
                title={title}
              >
                <SectionComponent
                  adjustments={adjustments}
                  setAdjustments={setAdjustments}
                  histogram={histogram}
                  theme={theme}
                  handleLutSelect={handleLutSelect}
                  onLutHover={setLutPreviewOverride}
                  appSettings={appSettings}
                  isWbPickerActive={isWbPickerActive}
                  toggleWbPicker={toggleWbPicker}
                  onDragStateChange={onDragStateChange}
                />
              </CollapsibleSection>
            </div>
          );
        })}
      </div>
    </div>
  );
}
