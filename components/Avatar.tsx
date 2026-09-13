import { initialsOf } from '@/lib/format';

export function Avatar({
  name,
  hue,
  size = 'md',
}: {
  name: string;
  hue: number;
  size?: 'xs' | 'md' | 'lg';
}) {
  const cls = size === 'xs' ? 'av xs' : size === 'lg' ? 'av lg' : 'av';
  return (
    <span className={cls} style={{ ['--person-h' as string]: String(hue) }} aria-hidden>
      {initialsOf(name)}
    </span>
  );
}

/** Overlapping avatar row, capped so a long list doesn't blow out the layout. */
export function AvatarStack({
  names,
  hues,
  max = 4,
}: {
  names: string[];
  hues: number[];
  max?: number;
}) {
  const shown = names.slice(0, max);
  const extra = names.length - shown.length;
  return (
    <span className="stack">
      {shown.map((n, i) => (
        <Avatar key={i} name={n} hue={hues[i]} size="xs" />
      ))}
      {extra > 0 && <span className="more">+{extra}</span>}
    </span>
  );
}
