import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

export const TestVideo = () => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  // Background gradient animation
  const hue = interpolate(frame, [0, durationInFrames], [200, 280]);

  // Title entrance with spring
  const titleScale = spring({
    frame,
    fps,
    config: { damping: 12 },
  });

  const titleY = interpolate(titleScale, [0, 1], [50, 0]);

  // Subtitle fade in with delay
  const subtitleOpacity = interpolate(frame, [30, 60], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // Rotating circle
  const rotation = interpolate(frame, [0, durationInFrames], [0, 360]);

  // Pulsing circle scale
  const pulseScale = interpolate(
    frame % 30,
    [0, 15, 30],
    [1, 1.15, 1],
  );

  // Exit animation
  const exitProgress = spring({
    frame,
    fps,
    delay: durationInFrames - 30,
    config: { damping: 200 },
  });

  const exitOpacity = interpolate(exitProgress, [0, 1], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        background: `linear-gradient(135deg, hsl(${hue}, 70%, 15%) 0%, hsl(${hue + 40}, 80%, 25%) 100%)`,
        justifyContent: "center",
        alignItems: "center",
        opacity: exitOpacity,
      }}
    >
      {/* Decorative rotating circle */}
      <div
        style={{
          position: "absolute",
          width: 300,
          height: 300,
          borderRadius: "50%",
          border: "3px solid rgba(255, 255, 255, 0.15)",
          transform: `rotate(${rotation}deg) scale(${pulseScale})`,
        }}
      />

      {/* Title */}
      <div
        style={{
          transform: `scale(${titleScale}) translateY(${titleY}px)`,
          fontSize: 80,
          fontWeight: "bold",
          color: "white",
          fontFamily: "Arial, sans-serif",
          textAlign: "center",
          textShadow: "0 4px 20px rgba(0,0,0,0.3)",
        }}
      >
        Sami Health
      </div>

      {/* Subtitle */}
      <div
        style={{
          opacity: subtitleOpacity,
          fontSize: 36,
          color: "rgba(255, 255, 255, 0.85)",
          fontFamily: "Arial, sans-serif",
          marginTop: 20,
          textAlign: "center",
        }}
      >
        Video de prueba con Remotion
      </div>
    </AbsoluteFill>
  );
};
