import logoUrl from '../assets/adhd-logo.png';

/** The shared ADHD monogram used by web, iOS, Watch and widgets. */
export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <img
      className="logo-mark"
      src={logoUrl}
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
      draggable={false}
    />
  );
}
