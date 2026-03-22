import React from "react";
import {
  AbsoluteFill,
  Img,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { loadFont } from "@remotion/google-fonts/Inter";

const { fontFamily } = loadFont();

// --- Types ---

type MessageData = {
  text: string;
  sender: "patient" | "amy";
  appearAt: number;
  time: string;
};

type TypingPeriod = {
  startAt: number;
  endAt: number;
};

// --- All messages in one continuous conversation ---

const allMessages: MessageData[] = [
  {
    text: "Hola Amy, cu\u00e1ndo es mi pr\u00f3xima cita?",
    sender: "patient",
    appearAt: 60,
    time: "4:32 p.m.",
  },
  {
    text: "Tu pr\u00f3xima cita es el jueves 27 de marzo a las 10:00 AM con el Dr. Rodr\u00edguez en el consultorio 3B del Instituto Nacional de Oncolog\u00eda \ud83d\udc99",
    sender: "amy",
    appearAt: 240,
    time: "4:32 p.m.",
  },
  {
    text: "Puedes recordarme un d\u00eda antes?",
    sender: "patient",
    appearAt: 540,
    time: "4:33 p.m.",
  },
  {
    text: "\u00bfNecesitas que te recuerde llevar algo en particular? Te escribir\u00e9 el mi\u00e9rcoles 26 para que tengas todo listo \u2705",
    sender: "amy",
    appearAt: 720,
    time: "4:33 p.m.",
  },
  {
    text: "Amy, despu\u00e9s de la quimio me dan muchas n\u00e1useas, qu\u00e9 puedo hacer?",
    sender: "patient",
    appearAt: 1020,
    time: "2:15 p.m.",
  },
  {
    text: "Te cuento, las n\u00e1useas post-quimio son muy comunes. Tu m\u00e9dico indic\u00f3 que puedes tomar la medicaci\u00f3n antin\u00e1useas 30 minutos antes de cada sesi\u00f3n.",
    sender: "amy",
    appearAt: 1200,
    time: "2:15 p.m.",
  },
  {
    text: "Tambi\u00e9n ayuda comer porciones peque\u00f1as, evitar olores fuertes y descansar recostada despu\u00e9s del tratamiento. Si las n\u00e1useas persisten m\u00e1s de 48 horas, av\u00edsame para contactar a tu equipo m\u00e9dico \ud83c\udf3f",
    sender: "amy",
    appearAt: 1380,
    time: "2:16 p.m.",
  },
  {
    text: "Qu\u00e9 deber\u00eda comer esta semana? No tengo mucho apetito",
    sender: "patient",
    appearAt: 1680,
    time: "11:20 a.m.",
  },
  {
    text: "Mira, cuando el apetito baja lo mejor es ir con porciones peque\u00f1as pero m\u00e1s seguidas. Tu nutricionista recomend\u00f3 prote\u00ednas suaves como pollo desmenuzado, huevo y yogur natural.",
    sender: "amy",
    appearAt: 1860,
    time: "11:20 a.m.",
  },
  {
    text: "Intenta tomar l\u00edquidos entre comidas y no durante. Y si un d\u00eda solo puedes tomar un batido, est\u00e1 bien, lo importante es mantener la hidrataci\u00f3n \ud83d\udc99",
    sender: "amy",
    appearAt: 2040,
    time: "11:21 a.m.",
  },
];

const allTyping: TypingPeriod[] = [
  { startAt: 120, endAt: 240 },
  { startAt: 600, endAt: 720 },
  { startAt: 1080, endAt: 1200 },
  { startAt: 1320, endAt: 1380 },
  { startAt: 1740, endAt: 1860 },
  { startAt: 1980, endAt: 2040 },
];

// --- Typing Indicator ---

const TypingIndicator: React.FC<{ frame: number }> = ({ frame }) => (
  <div style={{ alignSelf: "flex-start", display: "flex", alignItems: "center", gap: 14, marginTop: 12 }}>
    <Img
      src={staticFile("amy_logo.png")}
      style={{ width: 52, height: 52, borderRadius: 26, objectFit: "cover", flexShrink: 0 }}
    />
    <div
      style={{
        background: "#DCF8C6",
        borderRadius: "0px 18px 18px 18px",
        padding: "16px 22px",
        display: "flex",
        gap: 8,
        boxShadow: "0 2px 4px rgba(0,0,0,0.06)",
      }}
    >
      {[0, 1, 2].map((i) => {
        const phase = frame * 0.18 + i * 2.2;
        const y = Math.sin(phase) * 5;
        const opacity = interpolate(Math.sin(phase), [-1, 1], [0.3, 1]);
        return (
          <div
            key={i}
            style={{
              width: 13,
              height: 13,
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

// --- Chat Bubble ---

const ChatBubble: React.FC<{
  message: MessageData;
  chatFrame: number;
  fps: number;
  isRead: boolean;
  isFirstInCluster: boolean;
  showAvatar: boolean;
}> = ({ message, chatFrame, fps, isRead, isFirstInCluster, showAvatar }) => {
  const localFrame = chatFrame - message.appearAt;
  if (localFrame < 0) return null;

  const progress = spring({
    frame: localFrame,
    fps,
    config: { damping: 14, stiffness: 100 },
  });

  const translateY = interpolate(progress, [0, 1], [40, 0]);
  const opacity = interpolate(progress, [0, 0.4], [0, 1], {
    extrapolateRight: "clamp",
  });

  const isPatient = message.sender === "patient";

  return (
    <div
      style={{
        alignSelf: isPatient ? "flex-end" : "flex-start",
        maxWidth: "82%",
        transform: `translateY(${translateY}px)`,
        opacity,
        marginTop: isFirstInCluster ? 16 : 4,
        display: "flex",
        alignItems: "flex-end",
        gap: 14,
        flexDirection: isPatient ? "row-reverse" : "row",
      }}
    >
      {/* Avatar for Amy */}
      {!isPatient && (
        <div style={{ width: 52, flexShrink: 0 }}>
          {showAvatar && (
            <Img
              src={staticFile("amy_logo.png")}
              style={{ width: 52, height: 52, borderRadius: 26, objectFit: "cover" }}
            />
          )}
        </div>
      )}

      <div
        style={{
          background: isPatient ? "#FFFFFF" : "#DCF8C6",
          borderRadius: isPatient
            ? isFirstInCluster
              ? "18px 4px 18px 18px"
              : "18px 18px 18px 18px"
            : isFirstInCluster
              ? "4px 18px 18px 18px"
              : "18px 18px 18px 18px",
          padding: "14px 18px 10px",
          boxShadow: "0 2px 4px rgba(0,0,0,0.06)",
        }}
      >
        <div
          style={{
            fontSize: 40,
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
            gap: 4,
            marginTop: 4,
          }}
        >
          <span style={{ fontSize: 22, color: "#667781", fontFamily }}>
            {message.time}
          </span>
          {isPatient && (
            <svg width="22" height="14" viewBox="0 0 18 12" style={{ marginLeft: 2 }}>
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

// --- Main Composition ---

export const AmyDemo = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const isMessageRead = (msgIndex: number): boolean => {
    const msg = allMessages[msgIndex];
    if (msg.sender !== "patient") return false;
    for (let i = msgIndex + 1; i < allMessages.length; i++) {
      if (allMessages[i].sender === "amy") {
        return frame >= allMessages[i].appearAt + 20;
      }
    }
    return false;
  };

  const isFirstInCluster = (index: number): boolean => {
    if (index === 0) return true;
    return allMessages[index].sender !== allMessages[index - 1].sender;
  };

  const showAvatar = (index: number): boolean => {
    return isFirstInCluster(index);
  };

  const activeTyping = allTyping.find(
    (t) => frame >= t.startAt && frame < t.endAt
  );

  return (
    <AbsoluteFill style={{ background: "#ECE5DD" }}>
      {/* WhatsApp Header */}
      <div
        style={{
          height: 140,
          background: "#075E54",
          display: "flex",
          alignItems: "center",
          padding: "0 28px",
          gap: 18,
          zIndex: 10,
        }}
      >
        {/* Back arrow */}
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
          <path
            d="M15 19l-7-7 7-7"
            stroke="white"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>

        {/* Avatar */}
        <Img
          src={staticFile("amy_logo.png")}
          style={{
            width: 72,
            height: 72,
            borderRadius: 36,
            objectFit: "cover",
            flexShrink: 0,
          }}
        />

        {/* Name + status */}
        <div style={{ flex: 1 }}>
          <div
            style={{
              color: "white",
              fontSize: 34,
              fontWeight: 700,
              fontFamily,
              lineHeight: 1.2,
            }}
          >
            Amy
          </div>
          <div
            style={{
              color: "rgba(255,255,255,0.75)",
              fontSize: 22,
              fontFamily,
              lineHeight: 1.3,
            }}
          >
            en l&iacute;nea
          </div>
        </div>

        {/* Menu dots */}
        <div style={{ display: "flex", flexDirection: "column" as const, gap: 5 }}>
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              style={{
                width: 6,
                height: 6,
                borderRadius: 3,
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
          padding: "24px 28px",
        }}
      >
        {allMessages.map((msg, i) => (
          <ChatBubble
            key={i}
            message={msg}
            chatFrame={frame}
            fps={fps}
            isRead={isMessageRead(i)}
            isFirstInCluster={isFirstInCluster(i)}
            showAvatar={showAvatar(i)}
          />
        ))}
        {activeTyping && <TypingIndicator frame={frame} />}
      </div>

      {/* Input bar */}
      <div
        style={{
          height: 90,
          background: "#F0F0F0",
          display: "flex",
          alignItems: "center",
          padding: "0 20px",
          gap: 14,
        }}
      >
        <svg width="36" height="36" viewBox="0 0 28 28" fill="none">
          <circle cx="14" cy="14" r="12" stroke="#8E8E93" strokeWidth="1.5" />
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
            height: 56,
            background: "white",
            borderRadius: 28,
            padding: "0 24px",
            display: "flex",
            alignItems: "center",
            color: "#BDBDBD",
            fontSize: 26,
            fontFamily,
          }}
        >
          Mensaje
        </div>

        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: 28,
            background: "#075E54",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <svg width="24" height="24" viewBox="0 0 20 20" fill="none">
            <rect x="7" y="2" width="6" height="10" rx="3" fill="white" />
            <path
              d="M4 9.5c0 3.3 2.7 6 6 6s6-2.7 6-6"
              stroke="white"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
            <line x1="10" y1="15.5" x2="10" y2="18" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </div>
      </div>
    </AbsoluteFill>
  );
};
