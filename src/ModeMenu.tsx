import { AnimatePresence, m } from "motion/react";
import { menuMotion } from "./motion";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Check, ChevronDown, MessageSquare, Terminal } from "lucide-react";

type Mode = "agent" | "ask";

type ModeMenuProps = {
  mode: Mode;
  onChange: (mode: Mode) => void;
  disabled?: boolean;
};

const options = [
  {
    value: "agent",
    label: "Agent",
    description: "Read files, propose edits, and run commands.",
    Icon: Terminal,
  },
  {
    value: "ask",
    label: "Ask",
    description: "Explore your code with read-only tools.",
    Icon: MessageSquare,
  },
] as const;

export default function ModeMenu({
  mode,
  onChange,
  disabled = false,
}: ModeMenuProps) {
  const [open, setOpen] = useState(false);
  const controlRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const menuId = useId();
  const selectedIndex = options.findIndex((option) => option.value === mode);
  const selected = options[selectedIndex];
  const CurrentIcon = selected.Icon;

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  useEffect(() => {
    if (!open) return;
    optionRefs.current[selectedIndex]?.focus();

    function dismissOutside(event: PointerEvent) {
      if (
        event.target instanceof Node &&
        !controlRef.current?.contains(event.target)
      ) {
        setOpen(false);
      }
    }
    function dismissOnEscape(event: globalThis.KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    }
    document.addEventListener("pointerdown", dismissOutside);
    document.addEventListener("keydown", dismissOnEscape);
    return () => {
      document.removeEventListener("pointerdown", dismissOutside);
      document.removeEventListener("keydown", dismissOnEscape);
    };
  }, [open, selectedIndex]);

  function navigateMenu(event: KeyboardEvent<HTMLDivElement>) {
    const currentIndex = optionRefs.current.indexOf(
      document.activeElement as HTMLButtonElement,
    );
    let nextIndex: number;
    switch (event.key) {
      case "ArrowDown":
        nextIndex = (currentIndex + 1) % options.length;
        break;
      case "ArrowUp":
        nextIndex = (currentIndex + options.length - 1) % options.length;
        break;
      case "Home":
        nextIndex = 0;
        break;
      case "End":
        nextIndex = options.length - 1;
        break;
      case "Tab":
        triggerRef.current?.focus();
        setOpen(false);
        return;
      default:
        return;
    }
    event.preventDefault();
    optionRefs.current[nextIndex]?.focus();
  }

  return (
    <div className="mode-control" ref={controlRef}>
      <button
        className="mode-button"
        type="button"
        ref={triggerRef}
        aria-label="Task mode"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <CurrentIcon size={14} aria-hidden="true" />
        <span>{selected.label}</span>
        <ChevronDown size={12} aria-hidden="true" />
      </button>
      <AnimatePresence>
        {open && !disabled && (
          <m.div
            {...menuMotion}
            className="appearance-menu mode-menu"
            id={menuId}
            role="menu"
            aria-label="Task mode"
            onKeyDown={navigateMenu}
          >
            {options.map(({ value, label, description, Icon }, index) => (
              <button
                className={`mode-option${value === mode ? " active" : ""}`}
                key={value}
                type="button"
                role="menuitemradio"
                aria-checked={value === mode}
                tabIndex={-1}
                ref={(element) => {
                  optionRefs.current[index] = element;
                }}
                onClick={() => {
                  onChange(value);
                  setOpen(false);
                  triggerRef.current?.focus();
                }}
              >
                <Icon size={17} aria-hidden="true" />
                <span className="mode-option-copy">
                  <strong>{label}</strong>
                  <span>{description}</span>
                </span>
                {value === mode && <Check size={15} aria-hidden="true" />}
              </button>
            ))}
          </m.div>
        )}
      </AnimatePresence>
    </div>
  );
}
