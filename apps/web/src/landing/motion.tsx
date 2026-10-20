import { motion, useMotionValue, useReducedMotion, useSpring, type Variants } from "framer-motion";
import type { PointerEvent as ReactPointerEvent, ReactNode } from "react";

export const EASE = [0.22, 1, 0.36, 1] as const;

const container: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.09, delayChildren: 0.05 } },
};
const item: Variants = {
  hidden: { opacity: 0, y: 22, filter: "blur(6px)" },
  show: { opacity: 1, y: 0, filter: "blur(0px)", transition: { duration: 0.9, ease: EASE } },
};

/** Staggered reveal for a block of copy. Children wrapped in <RevealItem> animate in sequence. */
export function Reveal({ children, className, amount = 0.35, immediate = false }: { children: ReactNode; className?: string; amount?: number; immediate?: boolean }) {
  const reduced = useReducedMotion();
  if (reduced) return <div className={className}>{children}</div>;
  return (
    <motion.div
      className={className}
      variants={container}
      initial="hidden"
      {...(immediate ? { animate: "show" } : { whileInView: "show", viewport: { once: true, amount } })}
    >
      {children}
    </motion.div>
  );
}

export function RevealItem({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <motion.div className={className} variants={item}>
      {children}
    </motion.div>
  );
}

/** A CTA that leans gently towards the pointer. */
export function Magnetic({ children, href, className, onClick }: { children: ReactNode; href?: string; className?: string; onClick?: () => void }) {
  const reduced = useReducedMotion();
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const sx = useSpring(x, { stiffness: 260, damping: 18, mass: 0.4 });
  const sy = useSpring(y, { stiffness: 260, damping: 18, mass: 0.4 });
  const Tag = href ? motion.a : motion.button;
  return (
    <Tag
      href={href}
      onClick={onClick}
      type={href ? undefined : "button"}
      className={className}
      style={reduced ? undefined : { x: sx, y: sy }}
      onPointerMove={(e: ReactPointerEvent<HTMLElement>) => {
        if (reduced) return;
        const r = e.currentTarget.getBoundingClientRect();
        x.set((e.clientX - (r.left + r.width / 2)) * 0.22);
        y.set((e.clientY - (r.top + r.height / 2)) * 0.3);
      }}
      onPointerLeave={() => {
        x.set(0);
        y.set(0);
      }}
    >
      {children}
    </Tag>
  );
}
