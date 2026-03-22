import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { loadFont } from "@remotion/google-fonts/Inter";

const { fontFamily } = loadFont();

export const Intro = () => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  const titleProgress = spring({
    frame,
    fps,
    config: { damping: 12, stiffness: 80 },
  });

  const titleScale = interpolate(titleProgress, [0, 1], [0.85, 1]);
  const titleOpacity = interpolate(titleProgress, [0, 1], [0, 1]);

  const subtitleOpacity = interpolate(frame, [40, 80], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const taglineOpacity = interpolate(frame, [70, 110], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const exitOpacity = interpolate(
    frame,
    [durationInFrames - 40, durationInFrames],
    [1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  return (
    <AbsoluteFill
      style={{
        justifyContent: "center",
        alignItems: "center",
        opacity: exitOpacity,
      }}
    >
      <div
        style={{
          transform: `scale(${titleScale})`,
          opacity: titleOpacity,
          fontSize: 96,
          fontWeight: 700,
          color: "#1A1A2E",
          fontFamily,
          letterSpacing: -2,
        }}
      >
        Amy
      </div>
      <div
        style={{
          opacity: subtitleOpacity,
          fontSize: 30,
          color: "#4A5568",
          fontFamily,
          marginTop: 16,
          fontWeight: 400,
          textAlign: "center",
          padding: "0 80px",
        }}
      >
        Tu compa&ntilde;era de acompa&ntilde;amiento oncol&oacute;gico
      </div>
      <div
        style={{
          opacity: taglineOpacity,
          fontSize: 24,
          color: "#718096",
          fontFamily,
          marginTop: 14,
          fontWeight: 300,
          letterSpacing: 1,
        }}
      >
        Inteligente. Emp&aacute;tica. Siempre disponible.
      </div>
    </AbsoluteFill>
  );
};
