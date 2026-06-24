import { useEffect, useState } from 'react';
import tablerProvider from '../utils/tablerCatalog.js';

/**
 * Renders a single Tabler icon by name as an inline SVG.
 * Lazily waits for the catalog to load before rendering.
 */
export default function TablerIcon({ name, size = 18 }) {
  const [, forceUpdate] = useState(0);

  useEffect(() => {
    if (!tablerProvider.isReady()) {
      tablerProvider.load().then(() => forceUpdate((n) => n + 1));
    }
  }, []);

  const inner = tablerProvider.getData(name);
  if (!inner) return null;

  const isFilled = name.endsWith('-filled');
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill={isFilled ? 'currentColor' : 'none'}
      stroke={isFilled ? 'none' : 'currentColor'}
      strokeWidth={isFilled ? undefined : 2}
      strokeLinecap={isFilled ? undefined : 'round'}
      strokeLinejoin={isFilled ? undefined : 'round'}
      dangerouslySetInnerHTML={{ __html: inner }}
    />
  );
}
