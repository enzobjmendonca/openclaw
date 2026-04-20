export type DialeticaTarget = {
  roomId: string;
};

export function normalizeDialeticaTarget(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (!trimmed) {
    return undefined;
  }
  if (trimmed.startsWith("room:")) {
    const roomId = trimmed.slice("room:".length).trim();
    return roomId ? `room:${roomId}` : undefined;
  }
  return `room:${trimmed}`;
}

export function parseDialeticaTarget(raw: string): DialeticaTarget {
  const normalized = normalizeDialeticaTarget(raw);
  if (!normalized) {
    throw new Error(`Invalid Dialetica target: ${raw}`);
  }
  return { roomId: normalized.slice("room:".length) };
}

export function buildDialeticaTarget(target: DialeticaTarget): string {
  return `room:${target.roomId}`;
}
