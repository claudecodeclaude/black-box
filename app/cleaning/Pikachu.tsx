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
      case "Y":
        return "#FFD72A";
      case "K":
        return "#2b1e05";
      case "B":
        return "#6b3410";
      case "R":
        return "#E23A2E";
      case "W":
        return "#ffffff";
      default:
        return null;
    }
  };

  const rects: React.ReactNode[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = grid[y][x];
      const fill = color(c);
      if (!fill) continue;
      rects.push(
        <rect
          key={`${x}-${y}`}
          x={x * PX}
          y={y * PX}
          width={PX}
          height={PX}
          fill={fill}
        />
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
