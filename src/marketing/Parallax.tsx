import { useRef, type ReactNode } from 'react';
import { motion, useReducedMotion, useScroll, useTransform } from 'framer-motion';

// Wrap a block so it drifts vertically as it passes through the viewport.
// `distance` is the total travel in px (top of travel when the element enters
// from the bottom, bottom of travel as it exits the top). Disabled entirely
// when the viewer prefers reduced motion.
export function Parallax({
  children,
  distance = 60,
  style,
}: {
  children: ReactNode;
  distance?: number;
  style?: React.CSSProperties;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'end start'] });
  const y = useTransform(scrollYProgress, [0, 1], [distance, -distance]);
  return (
    <motion.div ref={ref} style={{ ...style, y: reduce ? 0 : y }}>
      {children}
    </motion.div>
  );
}
