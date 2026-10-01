/** "101-140, 201, 2A" -> ["101", ..., "140", "201", "2A"]; ranges keep their zero padding. */
export function expandRoomNumbers(text: string, maxRange = 500): string[] {
  const out: string[] = [];
  for (const part of text.split(/[,\s]+/).filter(Boolean)) {
    const range = /^(\d+)-(\d+)$/.exec(part);
    if (range) {
      const from = Number(range[1]);
      const to = Number(range[2]);
      if (to < from || to - from > maxRange) throw new Error(`Range ${part} is not valid`);
      const width = range[1]!.length;
      for (let n = from; n <= to; n++) out.push(String(n).padStart(width, "0"));
    } else {
      out.push(part);
    }
  }
  return [...new Set(out)];
}
