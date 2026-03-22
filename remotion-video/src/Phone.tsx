import React from "react";
import { useCurrentFrame, useVideoConfig, interpolate } from "remotion";
import { loadFont } from "@remotion/google-fonts/Inter";

const { fontFamily } = loadFont();

const PHONE_WIDTH = 820;
const PHONE_HEIGHT = 1640;
const BEZEL = 10;
const OUTER_RADIUS = 52;
const SCREEN_RADIUS = 44;

export const Phone: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();

  const reflectionX = interpolate(frame, [0, durationInFrames], [25, 65]);

  return (
    <div
      style={{
        width: PHONE_WIDTH + BEZEL * 2,
        height: PHONE_HEIGHT + BEZEL * 2,
        borderRadius: OUTER_RADIUS,
        background: "#1C1C1E",
        boxShadow:
          "0 24px 80px rgba(0,0,0,0.18), 0 8px 24px rgba(0,0,0,0.12)",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Screen */}
      <div
        style={{
          position: "absolute",
          top: BEZEL,
          left: BEZEL,
          width: PHONE_WIDTH,
          height: PHONE_HEIGHT,
          borderRadius: SCREEN_RADIUS,
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          background: "#ECE5DD",
        }}
      >
        {/* Status bar */}
        <div
          style={{
            height: 50,
            background: "#075E54",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "0 28px",
            position: "relative",
          }}
        >
          <span
            style={{
              color: "white",
              fontSize: 15,
              fontWeight: 600,
              fontFamily,
            }}
          >
            9:41
          </span>

          {/* Dynamic Island */}
          <div
            style={{
              width: 130,
              height: 32,
              background: "#000",
              borderRadius: 16,
              position: "absolute",
              left: "50%",
              transform: "translateX(-50%)",
              top: 9,
            }}
          />

          {/* Signal + Battery */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              color: "white",
            }}
          >
            {/* Signal bars */}
            <div style={{ display: "flex", alignItems: "flex-end", gap: 2 }}>
              {[8, 11, 14, 17].map((h, i) => (
                <div
                  key={i}
                  style={{
                    width: 3.5,
                    height: h,
                    background: "white",
                    borderRadius: 1,
                  }}
                />
              ))}
            </div>
            {/* Battery */}
            <div
              style={{
                width: 26,
                height: 12,
                border: "1.5px solid white",
                borderRadius: 3,
                position: "relative",
                display: "flex",
                alignItems: "center",
                padding: 1.5,
              }}
            >
              <div
                style={{
                  width: "80%",
                  height: "100%",
                  background: "white",
                  borderRadius: 1,
                }}
              />
              <div
                style={{
                  position: "absolute",
                  right: -4,
                  width: 2,
                  height: 5,
                  background: "white",
                  borderRadius: "0 1px 1px 0",
                }}
              />
            </div>
          </div>
        </div>

        {/* WhatsApp header */}
        <div
          style={{
            height: 68,
            background: "#075E54",
            display: "flex",
            alignItems: "center",
            padding: "0 14px",
            gap: 10,
            borderBottom: "1px solid rgba(0,0,0,0.1)",
          }}
        >
          {/* Back arrow */}
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
            <path
              d="M15 19l-7-7 7-7"
              stroke="white"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>

          {/* Avatar */}
          <div
            style={{
              width: 42,
              height: 42,
              borderRadius: 21,
              background: "linear-gradient(135deg, #25D366 0%, #128C7E 100%)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "white",
              fontWeight: 700,
              fontSize: 20,
              fontFamily,
              flexShrink: 0,
            }}
          >
            A
          </div>

          {/* Name + status */}
          <div style={{ flex: 1 }}>
            <div
              style={{
                color: "white",
                fontSize: 19,
                fontWeight: 600,
                fontFamily,
                lineHeight: 1.2,
              }}
            >
              Amy
            </div>
            <div
              style={{
                color: "rgba(255,255,255,0.75)",
                fontSize: 13,
                fontFamily,
                lineHeight: 1.2,
              }}
            >
              {"en l\u00EDnea"}
            </div>
          </div>

          {/* Menu dots */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 3,
              padding: "0 4px",
            }}
          >
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                style={{
                  width: 4,
                  height: 4,
                  borderRadius: 2,
                  background: "rgba(255,255,255,0.8)",
                }}
              />
            ))}
          </div>
        </div>

        {/* Chat area */}
        <div
          style={{
            flex: 1,
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
            justifyContent: "flex-end",
            padding: "16px 14px 10px",
          }}
        >
          {children}
        </div>

        {/* Input bar */}
        <div
          style={{
            height: 60,
            background: "#F0F0F0",
            display: "flex",
            alignItems: "center",
            padding: "0 10px",
            gap: 8,
          }}
        >
          {/* Emoji button */}
          <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
            <circle
              cx="14"
              cy="14"
              r="12"
              stroke="#8E8E93"
              strokeWidth="1.5"
            />
            <circle cx="10" cy="12" r="1.5" fill="#8E8E93" />
            <circle cx="18" cy="12" r="1.5" fill="#8E8E93" />
            <path
              d="M9.5 17.5c1.5 2 7.5 2 9 0"
              stroke="#8E8E93"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>

          <div
            style={{
              flex: 1,
              height: 42,
              background: "white",
              borderRadius: 21,
              padding: "0 18px",
              display: "flex",
              alignItems: "center",
              color: "#BDBDBD",
              fontSize: 16,
              fontFamily,
            }}
          >
            Mensaje
          </div>

          {/* Mic button */}
          <div
            style={{
              width: 42,
              height: 42,
              borderRadius: 21,
              background: "#075E54",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <rect
                x="7"
                y="2"
                width="6"
                height="10"
                rx="3"
                fill="white"
              />
              <path
                d="M4 9.5c0 3.3 2.7 6 6 6s6-2.7 6-6"
                stroke="white"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
              <line
                x1="10"
                y1="15.5"
                x2="10"
                y2="18"
                stroke="white"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </div>
        </div>
      </div>

      {/* Ambient light reflection */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          borderRadius: OUTER_RADIUS,
          background: `linear-gradient(${reflectionX}deg, rgba(255,255,255,0.04) 0%, transparent 40%)`,
          pointerEvents: "none",
        }}
      />
    </div>
  );
};
