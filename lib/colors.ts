/** Fixed, evenly-spaced hues so each person keeps one identity colour everywhere. */
export const PERSON_HUES = [268, 158, 24, 200, 340, 100, 306, 44, 182, 0, 224, 130];

export function hueForIndex(index: number): number {
  return PERSON_HUES[index % PERSON_HUES.length];
}

export function personStyle(index: number): React.CSSProperties {
  const hue = hueForIndex(index);
  return {
    '--person-h': String(hue),
  } as React.CSSProperties;
}
