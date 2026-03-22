import { Composition } from "remotion";
import { AmyDemo } from "./AmyDemo";

export const RemotionRoot = () => {
  return (
    <Composition
      id="AmyDemo"
      component={AmyDemo}
      durationInFrames={2400}
      fps={60}
      width={1080}
      height={1920}
    />
  );
};
