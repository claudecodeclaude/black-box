export function Pikachu({ size = 160 }: { size?: number }) {
  const PX = 8;
  const grid = [
    "...KK............KK...",
    "..KBBK..........KBBK..",
    "..KBBBK........KBBBK..",
    "..KBBBBK......KBBBBK..",
    "..KBBBYK......KYBBBK..",
    "..KBBYYKKKKKKKKYYBBK..",
    "..KBYYYYYYYYYYYYYYBK..",
    ".KYYYYYYYYYYYYYYYYYYK.",
    ".KYYYKKYYYYYYYYYYKKYK.",
    ".KYYKWWKYYYYYYYYKWWKK.",
    ".KYYKWKKYYYYYYYYKKWKK.",
    ".KRKKYYYYYYYYYYYYYKKRK",
    ".KRRKYYYYYKYKYYYYYKRRK",
    ".KYYYYYYYYKYKYYYYYYYYK",
    "..KYYYYYYYYYYYYYYYYYK.",
    "..KYYYYYKKKKYYYYYYYK..",
    "...KYYYKY..YKYYYYYK...",
    "....KYYK....KYYYYK....",
    "....KYK......KYYK.....",
    ".....KK......KKK......",
    "...........KKBBBBK....",
    "...........KBBBBBK....",
  ];
  const w = grid[0].length;
  const h = grid.length;

  const color = (c: string) => {
    switch (c) {
      case "Y": return "#FFD72A";
      case "K": return "#2b1e05";
      case "B": return "#6b3410";
      case "R": return "#E23A2E";
      case "W": return "#ffffff";
      default: return null;
    }
  };

  const rects: React.ReactNode[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = grid[y][x];
      const fill = color(c);
      if (!fill) continue;
      rects.push(
        <rect key={`${x}-${y}`} x={x * PX} y={y * PX} width={PX} height={PX} fill={fill} />
      );
    }
  }

  return (
    <svg
      width={size}
      height={(size * h) / w}
      viewBox={`0 0 ${w * PX} ${h * PX}`}
      style={{ imageRendering: "pixelated" }}
      xmlns="http://www.w3.org/2000/svg"
    >
      {rects}
    </svg>
  );
}

export function PikachuDancing({ size = 140 }: { size?: number }) {
  return (
    <div
      style={{
        animation: "gb-pika-dance 0.4s infinite alternate ease-in-out",
        display: "inline-block",
      }}
    >
      <Pikachu size={size} />
    </div>
  );
}

export function PikachuWithBubble({
  size = 200,
  quote,
}: {
  size?: number;
  quote: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        maxWidth: 320,
      }}
    >
      <div
        style={{
          position: "relative",
          background: "#fff",
          border: "3px solid #1a1a1a",
          borderRadius: 12,
          padding: "12px 14px",
          fontSize: 10,
          lineHeight: 1.6,
          textAlign: "center",
          marginBottom: 18,
          boxShadow: "4px 4px 0 #1a1a1a",
          fontFamily: "'Press Start 2P', monospace",
          color: "#1a1a1a",
        }}
      >
        {quote}
        <div
          style={{
            position: "absolute",
            bottom: -12,
            left: "50%",
            transform: "translateX(-50%)",
            width: 0,
            height: 0,
            borderLeft: "10px solid transparent",
            borderRight: "10px solid transparent",
            borderTop: "12px solid #1a1a1a",
          }}
        />
        <div
          style={{
            position: "absolute",
            bottom: -8,
            left: "50%",
            transform: "translateX(-50%)",
            width: 0,
            height: 0,
            borderLeft: "7px solid transparent",
            borderRight: "7px solid transparent",
            borderTop: "8px solid #fff",
          }}
        />
      </div>
      <Pikachu size={size} />
    </div>
  );
}
