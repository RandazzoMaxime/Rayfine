import { useRef, useEffect, useState } from 'react';
import { ChevronDown, Eye, EyeOff } from 'lucide-react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import Text from './Text';
import { TextVariants, TextWeights } from '../../types/typography';

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
  const [isHovering, setIsHovering] = useState(false);
  const hoverTimeoutRef = useRef<any>(null);

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

  const handleMouseEnter = () => {
    if (!canToggleVisibility) {
      return;
    }
    hoverTimeoutRef.current = setTimeout(() => {
      setIsHovering(true);
    }, 250);
  };

  const handleMouseLeave = () => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }
    setIsHovering(false);
  };

  const handleVisibilityClick = (e: any) => {
    e.stopPropagation();
    onToggleVisibility();
  };

  return (
    <div
      className="bg-surface/90 rounded-md overflow-hidden shrink-0 border border-border-color/40"
      onContextMenu={onContextMenu}
    >
      <div
        className="w-full px-2.5 py-1 flex items-center justify-between text-left hover:bg-card-active transition-colors duration-150 cursor-pointer select-none"
        onClick={(e) => onToggle(e)}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        <div className="flex items-center gap-1.5 min-w-0">
          <Text variant={TextVariants.heading} weight={TextWeights.medium} className="truncate uppercase tracking-wide text-[11px]">
            {title}
          </Text>
          {canToggleVisibility && (
            <div className="w-5 h-5 flex items-center justify-center shrink-0">
              <button
                className={clsx(
                  'p-0.5 rounded text-text-secondary hover:bg-bg-primary z-10 transition-opacity duration-200',
                  isHovering || !isContentVisible ? 'opacity-100' : 'opacity-0 pointer-events-none',
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
            </div>
          )}
        </div>
        <ChevronDown
          className={clsx('text-text-secondary transition-transform duration-200 shrink-0', { 'rotate-180': isOpen })}
          size={16}
        />
      </div>
      <div ref={wrapperRef} className="overflow-hidden transition-all duration-200 ease-in-out">
        <div
          className={clsx(
            'px-3 pb-2.5 pt-0.5 transition-opacity duration-200',
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
