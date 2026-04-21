import { ImageResponse } from "next/og";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: "#f7f3e7",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: "50%",
            border: "2px solid #1a1a1a",
            background: "#fff",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            position: "relative",
          }}
        >
          <div style={{ flex: 1, background: "#d82020" }} />
          <div style={{ height: 3, background: "#1a1a1a" }} />
          <div style={{ flex: 1, background: "#fff" }} />
          <div
            style={{
              position: "absolute",
              top: "50%",
              left: "50%",
              transform: "translate(-50%, -50%)",
              width: 10,
              height: 10,
              borderRadius: "50%",
              background: "#fff",
              border: "2px solid #1a1a1a",
              display: "flex",
            }}
          />
        </div>
      </div>
    ),
    size
  );
}
