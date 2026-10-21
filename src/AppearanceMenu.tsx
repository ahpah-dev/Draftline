import { AnimatePresence, m } from "motion/react";
import { menuMotion } from "./motion";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Check, Monitor, Moon, Sun } from "lucide-react";

type Appearance = "light" | "dark" | "system";

const storageKey = "codex-local:appearance:v1";
const options = [
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
  { value: "system", label: "System", Icon: Monitor },
] as const;

function initialAppearance(): Appearance {
  try {
    const value = localStorage.getItem(storageKey);
    if (value === "light" || value === "dark" || value === "system")
      return value;
  } catch {
    // Appearance still works when browser storage is unavailable.
  }
  return "light";
}

export default function AppearanceMenu() {
  const [appearance, setAppearance] = useState<Appearance>(initialAppearance);
  const [open, setOpen] = useState(false);
  const controlRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const menuId = useId();
  const selectedIndex = options.findIndex(
    (option) => option.value === appearance,
  );
  const CurrentIcon = options[selectedIndex].Icon;

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, appearance);
    } catch {
      // A storage restriction should not prevent changing the current theme.
    }
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const applyTheme = () => {
      document.documentElement.dataset.theme =
        appearance === "system"
          ? media.matches
            ? "dark"
            : "light"
          : appearance;
      document
        .querySelector('meta[name="theme-color"]')
        ?.setAttribute(
          "content",
          document.documentElement.dataset.theme === "dark"
            ? "#121316"
            : "#ffffff",
        );
    };
    applyTheme();
    if (appearance !== "system") return;
    media.addEventListener("change", applyTheme);
    return () => media.removeEventListener("change", applyTheme);
  }, [appearance]);

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
        setOpen(false);
        return;
      default:
        return;
    }
    event.preventDefault();
    optionRefs.current[nextIndex]?.focus();
  }

  return (
    <div className="appearance-control" ref={controlRef}>
      <button
        className="icon-button"
        type="button"
        ref={triggerRef}
        aria-label="Appearance"
        title="Appearance"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <CurrentIcon size={17} aria-hidden="true" />
      </button>
      <AnimatePresence>
        {open && (
          <m.div
            {...menuMotion}
            className="appearance-menu"
            id={menuId}
            role="menu"
            aria-label="Appearance"
            onKeyDown={navigateMenu}
          >
            <div className="appearance-menu-label" aria-hidden="true">
              Appearance
            </div>
            {options.map(({ value, label, Icon }, index) => (
              <button
                className={`appearance-option${value === appearance ? " active" : ""}`}
                type="button"
                key={value}
                ref={(element) => {
                  optionRefs.current[index] = element;
                }}
                role="menuitemradio"
                aria-checked={value === appearance}
                tabIndex={-1}
                onClick={() => {
                  setAppearance(value);
                  setOpen(false);
                  triggerRef.current?.focus();
                }}
              >
                <Icon size={16} aria-hidden="true" />
                <span>{label}</span>
                {value === appearance && <Check size={15} aria-hidden="true" />}
              </button>
            ))}
          </m.div>
        )}
      </AnimatePresence>
    </div>
  );
}
