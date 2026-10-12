'use client';
import { useEffect, useRef } from 'react';

type Point = { x: number; y: number; z: number };
type PathPoint = Pick<Point, 'x' | 'y'>;
const blue = '102,146,215',
  gold = '197,154,86',
  green = '105,157,135',
  red = '192,115,98';
const rgba = (color: string, alpha = 1) => `rgba(${color},${alpha})`;
// A stable, sparse mesh avoids random flicker and keeps per-frame work bounded.
const vertices = Array.from({ length: 360 }, (_, i) => {
  const y = 1 - (i / 359) * 2,
    radius = Math.sqrt(1 - y * y),
    angle = i * 2.39996;
  return { x: Math.cos(angle) * radius, y, z: Math.sin(angle) * radius };
});
const edges: [number, number][] = [];
vertices.forEach((a, i) => {
  for (let j = i + 1; j < vertices.length; j++) {
    const b = vertices[j];
    if ((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2 < 0.085) edges.push([i, j]);
  }
});

/** Brand motion reflects the supplied server phase; it never advances a business state. */
export function OrbitCanvas({
  phase,
  paused,
  pending,
}: {
  phase: string;
  paused: boolean;
  pending: boolean;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const time = useRef(0);
  useEffect(() => {
    const canvas = ref.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;
    const c = context;
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let w = 0,
      h = 0,
      px = 0,
      py = 0,
      frame = 0,
      last = 0,
      inView = true,
      disposed = false;
    const working = ['received', 'parsing', 'scanning'].includes(phase);
    const held = ['offline', 'quarantined', 'failed', 'archived'].includes(phase);
    const accent =
      phase === 'quarantined' ? gold : phase === 'failed' ? red : phase === 'ready' ? green : blue;
    const center = () => ({ x: w / 2, y: (h - 96) * 0.52 + 12 });
    const project = (x: number, y: number, z: number): Point => {
      const a = 0.18 + px * 0.16,
        b = -0.2 - py * 0.09;
      const X = x * Math.cos(a) + z * Math.sin(a),
        Z = -x * Math.sin(a) + z * Math.cos(a);
      const Y = y * Math.cos(b) - Z * Math.sin(b),
        depth = y * Math.sin(b) + Z * Math.cos(b);
      const f = 900 / (900 + depth),
        origin = center();
      return { x: origin.x + X * f, y: origin.y + Y * f, z: depth };
    };
    const dot = (x: number, y: number, r: number, color: string, a = 1) => {
      c.beginPath();
      c.arc(x, y, r, 0, Math.PI * 2);
      c.fillStyle = rgba(color, a);
      c.fill();
    };
    const line = (pts: PathPoint[], color: string, width = 1, a = 1) => {
      c.beginPath();
      pts.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y)));
      c.strokeStyle = rgba(color, a);
      c.lineWidth = width;
      c.stroke();
    };
    const glow = (x: number, y: number, r: number, color: string, strength: number) => {
      // Fade to full transparency before reaching the canvas bounds: no cropped glow panel.
      r = Math.min(r, x - 2, y - 2, w - x - 2, h - y - 2);
      if (r <= 0) return;
      const g = c.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, rgba(color, strength));
      g.addColorStop(0.35, rgba(color, strength * 0.55));
      g.addColorStop(1, rgba(color, 0));
      c.fillStyle = g;
      c.fillRect(x - r, y - r, r * 2, r * 2);
    };
    const pearl = (p: Point, radius: number, color: string) => {
      glow(p.x, p.y, radius * 3.5, color, 0.13);
      const fill = c.createRadialGradient(p.x - radius * 0.35, p.y - radius * 0.4, 0.1, p.x, p.y, radius);
      fill.addColorStop(0, '#fff');
      fill.addColorStop(0.35, '#f8fbff');
      fill.addColorStop(0.7, rgba(color, 0.6));
      fill.addColorStop(1, rgba(color, 0.95));
      c.beginPath();
      c.arc(p.x, p.y, radius, 0, Math.PI * 2);
      c.fillStyle = fill;
      c.fill();
      c.strokeStyle = 'rgba(255,255,255,.85)';
      c.lineWidth = 0.7;
      c.stroke();
    };
    const paint = () => {
      if (!w || !h) return;
      const { x: cx, y: cy } = center(),
        R = Math.min(w * 0.245, (h - 110) * 0.33, 118),
        t = time.current;
      c.clearRect(0, 0, w, h);
      c.globalAlpha = phase === 'offline' || phase === 'archived' ? 0.5 : 1;
      glow(cx - R * 0.55, cy - R * 0.15, R * 2.15, blue, 0.085);
      glow(cx + R * 0.6, cy + R * 0.15, R * 1.65, gold, 0.065);
      // Slow ambient glints are decorative; only the working phases emit data particles.
      for (let i = 0; i < 15; i++) {
        const a = i * 2.39996,
          rr = R * (1.2 + (i % 4) * 0.15);
        const x = cx + Math.cos(a) * rr,
          y = cy + Math.sin(a) * rr * 0.77;
        const opacity = 0.2 + Math.sin(t * 0.65 + i) * 0.09;
        glow(x, y, 5, '255,255,255', opacity * 2);
        dot(x, y, i % 3 ? 0.8 : 1.25, i % 4 ? blue : gold, opacity);
      }
      const rings = [0, 1, 2].map((ring) => {
        const rr = R * [1.38, 1.46, 1.64][ring],
          tilt = [0.28, 1.18, -0.58][ring];
        return Array.from({ length: 181 }, (_, j) => {
          const angle = (j / 180) * Math.PI * 2,
            x = Math.cos(angle) * rr,
            y = Math.sin(angle) * rr * 0.38;
          return project(
            x * Math.cos(tilt) - y * Math.sin(tilt),
            x * Math.sin(tilt) + y * Math.cos(tilt),
            Math.sin(angle) * rr * 0.68,
          );
        });
      });
      const drawRings = (front: boolean) =>
        rings.forEach((path, ring) => {
          c.beginPath();
          for (let j = 1; j < path.length; j++) {
            const a = path[j - 1],
              b = path[j];
            if (b.z < 0 === front) {
              c.moveTo(a.x, a.y);
              c.lineTo(b.x, b.y);
            }
          }
          c.setLineDash(ring === 2 ? [1, 3] : []);
          c.lineWidth = ring === 2 ? 0.65 : 1.05;
          c.strokeStyle = rgba(ring === 2 ? blue : gold, front ? (ring === 2 ? 0.36 : 0.73) : 0.25);
          c.stroke();
          c.setLineDash([]);
          for (let k = 0; k < 2; k++) {
            const p = path[Math.floor(((t * (working ? 0.038 : 0.012) + k / 2 + ring * 0.19) % 1) * 180)];
            if (p.z < 0 === front)
              pearl(p, (front ? 3.7 : 2.7) * Math.min(1.2, R / 85), (ring + k) % 2 ? blue : gold);
          }
        });
      drawRings(false);
      const spread = phase === 'received' ? 1.07 : 1,
        rotation = held ? 0 : t * (working ? 0.12 : 0.035);
      const points = vertices.map((p) =>
        project(
          (p.x * Math.cos(rotation) + p.z * Math.sin(rotation)) * R * spread,
          p.y * R * spread,
          (-p.x * Math.sin(rotation) + p.z * Math.cos(rotation)) * R * spread,
        ),
      );
      const shell = c.createRadialGradient(cx - R * 0.32, cy - R * 0.4, 0, cx, cy, R * 1.03);
      shell.addColorStop(0, 'rgba(255,255,255,.96)');
      shell.addColorStop(0.45, 'rgba(250,253,255,.72)');
      shell.addColorStop(0.8, 'rgba(217,231,246,.3)');
      shell.addColorStop(1, 'rgba(255,255,255,.6)');
      c.beginPath();
      c.arc(cx, cy, R * 1.005, 0, Math.PI * 2);
      c.fillStyle = shell;
      c.fill();
      c.strokeStyle = rgba(blue, 0.12);
      c.lineWidth = 0.6;
      c.stroke();
      [false, true].forEach((front) => {
        c.beginPath();
        edges.forEach(([i, j]) => {
          const a = points[i],
            b = points[j];
          if (a.z + b.z < 0 === front) {
            c.moveTo(a.x, a.y);
            c.lineTo(b.x, b.y);
          }
        });
        c.strokeStyle = rgba(blue, front ? 0.18 : 0.06);
        c.lineWidth = 0.5;
        c.stroke();
      });
      points.forEach((p, i) => {
        const front = Math.max(0, Math.min(1, (R - p.z) / (R * 2)));
        dot(p.x, p.y, 0.45 + front * 0.7, i % 13 === 0 ? gold : blue, 0.1 + front * 0.6);
      });
      glow(cx - R * 0.33, cy - R * 0.4, R * 0.6, '255,255,255', 0.63);
      glow(cx + R * 0.15, cy + R * 0.2, R * 0.66, gold, 0.07);
      drawRings(true);
      if (working) {
        [
          [-0.43, 0.22],
          [-0.39, -0.19],
          [0.39, 0.2],
          [0.43, -0.22],
        ].forEach(([dx, dy], i) => {
          const start = { x: cx + w * dx, y: cy + (h - 96) * dy },
            end = { x: cx + Math.sign(dx) * R * 0.65, y: cy + dy * R },
            path: PathPoint[] = [];
          for (let j = 0; j <= 50; j++) {
            const p = j / 50;
            path.push({
              x: start.x + (end.x - start.x) * p,
              y: start.y + (end.y - start.y) * p + Math.sin(p * Math.PI) * 12,
            });
          }
          line(path, blue, 0.7, 0.25);
          for (let k = 0; k < 6; k++) {
            const p = path[Math.floor(((t * 0.15 + k / 6 + i * 0.12) % 1) * 50)];
            dot(p.x, p.y, 1.5, i % 2 ? gold : blue, 0.8);
          }
        });
      }
      if (phase === 'scanning') {
        const yy = -R + 2 * R * ((t * 0.22) % 1),
          rr = Math.sqrt(Math.max(0, R * R - yy * yy)),
          scan: Point[] = [];
        for (let j = 0; j <= 100; j++) {
          const a = (j / 100) * Math.PI * 2;
          scan.push(project(Math.cos(a) * rr, yy, Math.sin(a) * rr));
        }
        line(scan, gold, 1.2, 0.8);
        glow(cx, cy + yy, 40, gold, 0.1);
      }
      if (phase === 'quarantined' || pending) {
        c.setLineDash([2, 6]);
        c.beginPath();
        c.arc(cx, cy, R * 1.08, 0, Math.PI * 2);
        c.strokeStyle = rgba(gold, 0.4);
        c.lineWidth = 0.8;
        c.stroke();
        c.setLineDash([]);
      }
      const breath = held ? 1 : 1 + Math.sin(t * 0.7) * 0.08;
      glow(cx, cy, R * 0.4 * breath, accent, 0.12);
      glow(cx, cy, 12, '255,255,255', 0.95);
      dot(cx, cy, 2.4, '255,255,255', 0.96);
      c.globalAlpha = 1;
    };
    // Quarantine stops the data particles. The outer brand orbit can remain in a calm idle state.
    const moving = () =>
      !paused &&
      !motion.matches &&
      !['offline', 'archived'].includes(phase) &&
      inView &&
      document.visibilityState === 'visible';
    const tick = (stamp: number) => {
      frame = 0;
      if (!moving() || disposed) return;
      if (!last || stamp - last >= 32) {
        time.current += last ? Math.min((stamp - last) / 1000, 0.1) : 0;
        last = stamp;
        paint();
      }
      frame = requestAnimationFrame(tick);
    };
    const sync = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      last = 0;
      paint();
      if (moving() && !disposed) frame = requestAnimationFrame(tick);
    };
    const resize = new ResizeObserver(() => {
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      sync();
    });
    resize.observe(canvas);
    const observer = new IntersectionObserver(([entry]) => {
      inView = entry.isIntersecting;
      sync();
    });
    observer.observe(canvas);
    const pointer = (e: PointerEvent) => {
      if (motion.matches || paused || held) return;
      const b = canvas.getBoundingClientRect();
      px = (e.clientX - b.left) / b.width - 0.5;
      py = (e.clientY - b.top) / b.height - 0.5;
    };
    const leave = () => {
      px = 0;
      py = 0;
    };
    canvas.addEventListener('pointermove', pointer);
    canvas.addEventListener('pointerleave', leave);
    motion.addEventListener('change', sync);
    document.addEventListener('visibilitychange', sync);
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      resize.disconnect();
      observer.disconnect();
      motion.removeEventListener('change', sync);
      document.removeEventListener('visibilitychange', sync);
      canvas.removeEventListener('pointermove', pointer);
      canvas.removeEventListener('pointerleave', leave);
    };
  }, [phase, paused, pending]);
  return <canvas ref={ref} className="flow-orbit-canvas" aria-hidden="true" />;
}
