import { useState, useEffect } from 'react';

// Touch-laptop fix: maxTouchPoints > 0 is true on Surface-style laptops whose
// players use keyboard/mouse. Those must NOT auto-accelerate nor see touch
// buttons. Touch mode enables only on coarse pointers (phones/tablets) or
// after the user actually touches the screen.
export const useTouchScreen = () => {
  const [isTouchScreen, setIsTouchScreen] = useState(() => {
    try {
      return Boolean(
        globalThis.window?.matchMedia?.("(pointer: coarse)").matches
      );
    } catch {
      return false;
    }
  });

  useEffect(() => {
    const enable = () => setIsTouchScreen(true);
    window.addEventListener('touchstart', enable, { once: true, passive: true });
    return () => {
      window.removeEventListener('touchstart', enable);
    };
  }, []);

  return isTouchScreen;
};
