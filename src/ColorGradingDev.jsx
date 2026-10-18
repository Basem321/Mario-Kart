import { useEffect } from "react";
import { useControls } from "leva";
import { useGameManager } from "./gameManager";
import { TRACK_COLOR_PRESETS, liveDevGrading } from "./colorGradingConfig";

/**
 * Developer-only Leva controls.
 * This component is only dynamically mounted when the URL contains ?debug=color.
 */
export default function ColorGradingDev() {
  const selectedTrackId = useGameManager((s) => s.selectedTrackId);
  const activePreset =
    TRACK_COLOR_PRESETS[selectedTrackId] ?? TRACK_COLOR_PRESETS["mario-circuit"];

  const controls = useControls(`Color Grading (${selectedTrackId})`, {
    brightness: { value: activePreset.brightness, min: -1, max: 1, step: 0.001 },
    contrast: { value: activePreset.contrast, min: 0, max: 3, step: 0.001 },
    saturation: { value: activePreset.saturation, min: -1, max: 3, step: 0.001 },
    vibrancy: { value: activePreset.vibrancy, min: -1, max: 3, step: 0.001 },
    hueOffset: { value: activePreset.hueOffset, min: -Math.PI, max: Math.PI, step: 0.001 },
    gamma: { value: activePreset.gamma, min: 0, max: 3, step: 0.001 },
    shadowTint: { value: activePreset.shadowTint, label: "Shadow Tint" },
    highlightTint: { value: activePreset.highlightTint, label: "Highlight Tint" },
    splitToneBalance: { value: activePreset.splitToneBalance, min: 0, max: 1, step: 0.001 },
    exposure: { value: activePreset.exposure, min: -2, max: 3, step: 0.001 },
    kelvin: { value: activePreset.kelvin, min: 1000, max: 40000, step: 50 },
    chromaticAberration: { value: activePreset.chromaticAberration, min: -5, max: 5, step: 0.01 },
  });

  useEffect(() => {
    liveDevGrading.current = controls;
    return () => {
      liveDevGrading.current = null;
    };
  }, [controls]);

  return null;
}
