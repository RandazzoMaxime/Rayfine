import { useRef, useEffect } from 'react';
import { ChevronDown, Eye, EyeOff } from 'lucide-react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';

interface CollapsibleSectionProps {
  canToggleVisibility?: boolean;
  children: any;
  isContentVisible: boolean;
  isOpen: boolean;
  onContextMenu?: any;
  onToggle: any;
  onToggleVisibility?: any;
  title: string;
}

export default function CollapsibleSection({
  canToggleVisibility = true,
  children,
  isContentVisible,
  isOpen,
  onContextMenu,
  onToggle,
  onToggleVisibility = () => {},
  title,
}: CollapsibleSectionProps) {
  const { t } = useTranslation();
  const contentRef = useRef<HTMLDivElement | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    const content = contentRef.current;
    if (!wrapper || !content) {
      return;
    }

    const updateMaxHeight = () => {
      if (isOpen) {
        const contentHeight = content.scrollHeight;
        wrapper.style.maxHeight = `${contentHeight}px`;
      } else {
        wrapper.style.maxHeight = '0px';
      }
    };

    updateMaxHeight();

    const resizeObserver = new ResizeObserver(updateMaxHeight);
    resizeObserver.observe(content);

    return () => resizeObserver.disconnect();
  }, [isOpen]);

  const handleVisibilityClick = (e: any) => {
    e.stopPropagation();
    onToggleVisibility();
  };

  return (
    <div className="shrink-0 border-t border-border-color/40" onContextMenu={onContextMenu}>
      <div
        className="w-full px-2 py-1.5 min-h-[28px] flex items-center justify-between text-left hover:bg-card-active/50 cursor-pointer select-none"
        onClick={(e) => onToggle(e)}
      >
        {canToggleVisibility && (
          <button
            type="button"
            className={clsx(
              'p-0.5 rounded shrink-0 z-10',
              isContentVisible
                ? 'text-text-primary/80 hover:text-text-primary'
                : 'text-text-secondary/50 hover:text-text-secondary',
            )}
            onClick={handleVisibilityClick}
            data-tooltip={
              isContentVisible
                ? t('ui.collapsibleSection.disableSection')
                : t('ui.collapsibleSection.enableSection')
            }
          >
            {isContentVisible ? <Eye size={14} /> : <EyeOff size={14} />}
          </button>
        )}
        <div className="flex items-center gap-0.5 min-w-0 ml-auto">
          <span className="truncate text-[13px] font-medium text-text-primary leading-none">{title}</span>
          <ChevronDown
            className={clsx('text-text-secondary transition-transform duration-200 shrink-0', { 'rotate-180': isOpen })}
            size={14}
          />
        </div>
      </div>
      <div ref={wrapperRef} className="overflow-hidden transition-all duration-200 ease-in-out">
        <div
          className={clsx(
            'px-2 pb-2 pt-1.5 transition-opacity duration-200',
            !isContentVisible && 'opacity-30 pointer-events-none',
          )}
          ref={contentRef}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
