import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { loadFont } from "@remotion/google-fonts/Inter";

const { fontFamily } = loadFont();

export const Outro = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const titleProgress = spring({
    frame,
    fps,
    config: { damping: 14, stiffness: 80 },
    delay: 30,
  });

  const titleScale = interpolate(titleProgress, [0, 1], [0.9, 1]);
  const titleOpacity = interpolate(titleProgress, [0, 1], [0, 1]);

  const line1Opacity = interpolate(frame, [60, 100], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const line2Opacity = interpolate(frame, [90, 130], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const logoOpacity = interpolate(frame, [120, 160], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 0,
        }}
      >
        <div
          style={{
            transform: `scale(${titleScale})`,
            opacity: titleOpacity,
            fontSize: 88,
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
            opacity: line1Opacity,
            fontSize: 28,
            color: "#4A5568",
            fontFamily,
            marginTop: 20,
            fontWeight: 400,
            textAlign: "center",
          }}
        >
          {"Acompa\u00F1amiento oncol\u00F3gico inteligente"}
        </div>
        <div
          style={{
            opacity: line2Opacity,
            fontSize: 22,
            color: "#718096",
            fontFamily,
            marginTop: 12,
            fontWeight: 300,
          }}
        >
          Disponible 24/7 por WhatsApp
        </div>

        {/* Logo placeholder */}
        <div
          style={{
            opacity: logoOpacity,
            marginTop: 60,
            width: 80,
            height: 80,
            borderRadius: 20,
            background:
              "linear-gradient(135deg, #075E54 0%, #25D366 100%)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            style={{
              color: "white",
              fontSize: 36,
              fontWeight: 700,
              fontFamily,
            }}
          >
            A
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};
