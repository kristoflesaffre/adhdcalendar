import { useEffect, useState } from 'react';

/** Below this width we render the phone shell (agenda list, drawer, FAB)
 * instead of the desktop grid + sidebar layout. */
export const MOBILE_QUERY = '(max-width: 700px)';

export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(() => window.matchMedia(MOBILE_QUERY).matches);

  useEffect(() => {
    const mq = window.matchMedia(MOBILE_QUERY);
    const onChange = () => setIsMobile(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  return isMobile;
}
