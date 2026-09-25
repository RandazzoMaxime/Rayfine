import { Check } from 'lucide-react';
import clsx from 'clsx';

interface CheckBoxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  className?: string;
  label?: string;
  disabled?: boolean;
}

/**
 * Plain React checkbox (no native <input>): the check mark renders synchronously with state,
 * avoiding WebKit's delayed/missed repaints of accent-colored native checkboxes.
 */
export default function CheckBox({ checked, onChange, className, label, disabled }: CheckBoxProps) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onChange(!checked);
      }}
      onDoubleClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      className={clsx(
        'w-4 h-4 shrink-0 rounded-[3px] border flex items-center justify-center disabled:opacity-40',
        checked ? 'bg-accent border-accent text-button-text' : 'bg-black/40 border-white/60 text-transparent',
        className,
      )}
    >
      <Check size={11} strokeWidth={3} />
    </button>
  );
}
