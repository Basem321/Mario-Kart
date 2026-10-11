import { useGameStore } from "../store";
import { useRef } from "react";

export const Buttons = () => {
  const setJumpButtonPressed = useGameStore((state) => state.setJumpButtonPressed);
  const setUseItemPressed = useGameStore((state) => state.setUseItemPressed);
  const jumpRef = useRef(null);
  const itemRef = useRef(null);

  const bindHold = (set, ref) => ({
    onTouchStart: () => {
      set(true);
      ref.current?.classList.add("pressed");
    },
    onTouchEnd: () => {
      set(false);
      ref.current?.classList.remove("pressed");
    },
    onMouseDown: () => {
      set(true);
      ref.current?.classList.add("pressed");
    },
    onMouseUp: () => {
      set(false);
      ref.current?.classList.remove("pressed");
    },
    onMouseLeave: () => {
      set(false);
      ref.current?.classList.remove("pressed");
    },
  });

  const jumpBind = bindHold(setJumpButtonPressed, jumpRef);
  const itemBind = bindHold(setUseItemPressed, itemRef);

  return (
    <div className="bottom-right">
      <button
        ref={itemRef}
        aria-label="Use item"
        className="touch-button touch-button-item"
        {...itemBind}
      >
        B
      </button>
      <button
        ref={jumpRef}
        aria-label="Drift"
        className="touch-button"
        {...jumpBind}
      >
        A
      </button>
    </div>
  );
};
