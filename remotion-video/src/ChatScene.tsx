import React from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { loadFont } from "@remotion/google-fonts/Inter";
import { Phone } from "./Phone";

const { fontFamily } = loadFont();

// --- Types ---

export type MessageData = {
  text: string;
  sender: "patient" | "amy";
  appearAt: number;
  time: string;
};

export type TypingPeriod = {
  startAt: number;
  endAt: number;
};

export type ChatSceneProps = {
  title: string;
  messages: MessageData[];
  typing: TypingPeriod[];
};

// --- Typing Indicator ---

const TypingIndicator: React.FC<{ frame: number }> = ({ frame }) => {
  return (
    <div
      style={{
        alignSelf: "flex-start",
        maxWidth: "30%",
      }}
    >
      <div
        style={{
          background: "#DCF8C6",
          borderRadius: "0px 8px 8px 8px",
          padding: "12px 16px",
          display: "flex",
          gap: 6,
          boxShadow: "0 1px 1px rgba(0,0,0,0.06)",
        }}
      >
        {[0, 1, 2].map((i) => {
          const phase = frame * 0.2 + i * 2.2;
          const y = Math.sin(phase) * 4;
          const opacity = interpolate(Math.sin(phase), [-1, 1], [0.35, 1]);

          return (
            <div
              key={i}
              style={{
                width: 9,
                height: 9,
                borderRadius: "50%",
                background: "#8C9EA6",
                transform: `translateY(${y}px)`,
                opacity,
              }}
            />
          );
        })}
      </div>
    </div>
  );
};

// --- Chat Bubble ---

const ChatBubble: React.FC<{
  message: MessageData;
  chatFrame: number;
  fps: number;
  isRead: boolean;
  isFirstInCluster: boolean;
}> = ({ message, chatFrame, fps, isRead, isFirstInCluster }) => {
  const localFrame = chatFrame - message.appearAt;

  if (localFrame < 0) return null;

  const progress = spring({
    frame: localFrame,
    fps,
    config: { damping: 15, stiffness: 120 },
  });

  const translateY = interpolate(progress, [0, 1], [35, 0]);
  const opacity = interpolate(progress, [0, 0.4], [0, 1], {
    extrapolateRight: "clamp",
  });

  const isPatient = message.sender === "patient";

  return (
    <div
      style={{
        alignSelf: isPatient ? "flex-end" : "flex-start",
        maxWidth: "78%",
        transform: `translateY(${translateY}px)`,
        opacity,
        marginBottom: 3,
        marginTop: isFirstInCluster ? 8 : 0,
      }}
    >
      <div
        style={{
          background: isPatient ? "#FFFFFF" : "#DCF8C6",
          borderRadius: isPatient
            ? isFirstInCluster
              ? "8px 0px 8px 8px"
              : "8px 8px 8px 8px"
            : isFirstInCluster
              ? "0px 8px 8px 8px"
              : "8px 8px 8px 8px",
          padding: "8px 10px 5px",
          boxShadow: "0 1px 1px rgba(0,0,0,0.06)",
          position: "relative",
        }}
      >
        <div
          style={{
            fontSize: 16.5,
            lineHeight: 1.45,
            color: "#111B21",
            fontFamily,
            wordBreak: "break-word",
          }}
        >
          {message.text}
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            alignItems: "center",
            gap: 3,
            marginTop: 1,
            marginBottom: -1,
          }}
        >
          <span
            style={{
              fontSize: 11,
              color: "#667781",
              fontFamily,
            }}
          >
            {message.time}
          </span>
          {isPatient && (
            <svg
              width="18"
              height="12"
              viewBox="0 0 18 12"
              style={{ marginLeft: 1 }}
            >
              <path
                d="M1 6.5l3.5 3.5L11 3"
                stroke={isRead ? "#53BDEB" : "#8696A0"}
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
              <path
                d="M5 6.5l3.5 3.5L15 3"
                stroke={isRead ? "#53BDEB" : "#8696A0"}
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
            </svg>
          )}
        </div>
      </div>
    </div>
  );
};

// --- Chat Area ---

const ChatArea: React.FC<{
  messages: MessageData[];
  typing: TypingPeriod[];
  chatFrame: number;
  fps: number;
}> = ({ messages, typing, chatFrame, fps }) => {
  const activeTyping = typing.find(
    (t) => chatFrame >= t.startAt && chatFrame < t.endAt
  );

  const isMessageRead = (msgIndex: number): boolean => {
    const msg = messages[msgIndex];
    if (msg.sender !== "patient") return false;
    for (let i = msgIndex + 1; i < messages.length; i++) {
      if (messages[i].sender === "amy") {
        return chatFrame >= messages[i].appearAt + 15;
      }
    }
    return false;
  };

  const isFirstInCluster = (index: number): boolean => {
    if (index === 0) return true;
    return messages[index].sender !== messages[index - 1].sender;
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
      }}
    >
      {messages.map((msg, i) => (
        <ChatBubble
          key={i}
          message={msg}
          chatFrame={chatFrame}
          fps={fps}
          isRead={isMessageRead(i)}
          isFirstInCluster={isFirstInCluster(i)}
        />
      ))}
      {activeTyping && <TypingIndicator frame={chatFrame} />}
    </div>
  );
};

// --- Main Scene Component ---

export const ChatScene: React.FC<ChatSceneProps> = ({
  title,
  messages,
  typing,
}) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  // Title card: fade in 0-18f, hold, fade out 102-120f
  const titleOpacity = interpolate(
    frame,
    [0, 18, 120, 150],
    [0, 1, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  const titleScale = spring({
    frame,
    fps,
    config: { damping: 200 },
  });

  // Phone: fade in after title, fade out at end of scene
  const phoneOpacity = interpolate(
    frame,
    [110, 155, durationInFrames - 60, durationInFrames],
    [0, 1, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  const phoneScale = interpolate(
    frame,
    [110, 155],
    [0.97, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  // Chat messages start at frame 160 within the scene
  const chatFrame = Math.max(0, frame - 170);

  return (
    <AbsoluteFill>
      {/* Section title card */}
      <AbsoluteFill
        style={{
          justifyContent: "center",
          alignItems: "center",
          opacity: titleOpacity,
        }}
      >
        <div
          style={{
            fontSize: 40,
            fontWeight: 600,
            color: "#1A1A2E",
            fontFamily,
            textAlign: "center",
            padding: "0 60px",
            transform: `scale(${titleScale})`,
          }}
        >
          {title}
        </div>
        <div
          style={{
            width: 50,
            height: 3,
            background: "#25D366",
            borderRadius: 2,
            marginTop: 16,
          }}
        />
      </AbsoluteFill>

      {/* Phone with chat */}
      <AbsoluteFill
        style={{
          justifyContent: "center",
          alignItems: "center",
          opacity: phoneOpacity,
          transform: `scale(${phoneScale})`,
        }}
      >
        <Phone>
          <ChatArea
            messages={messages}
            typing={typing}
            chatFrame={chatFrame}
            fps={fps}
          />
        </Phone>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
