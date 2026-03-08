import { useCallback, useRef } from 'react';

interface ClockDialProps {
  hour: number;
  onChange: (hour: number) => void;
  size?: number;
}

const RADIUS = 44;
const CENTER = 50;
const TICK_OUTER = 44;
const TICK_INNER_MAJOR = 36;
const TICK_INNER_MINOR = 39;
const LABEL_RADIUS = 30;
const NEEDLE_LENGTH = 28;

export const ClockDial = ({ hour, onChange, size = 140 }: ClockDialProps) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const dragging = useRef(false);

  const angleFromHour = (h: number) => (h / 24) * 360 - 90;

  const hourFromAngle = (angleDeg: number) => {
    let a = (angleDeg + 90) % 360;
    if (a < 0) a += 360;
    return Math.round((a / 360) * 24) % 24;
  };

  const getAngleFromEvent = useCallback((e: React.MouseEvent | MouseEvent) => {
    const svg = svgRef.current;
    if (!svg) return 0;
    const rect = svg.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = e.clientX - cx;
    const dy = e.clientY - cy;
    return Math.atan2(dy, dx) * (180 / Math.PI);
  }, []);

  const handlePointerDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    const angle = getAngleFromEvent(e);
    onChange(hourFromAngle(angle));

    const handleMove = (ev: MouseEvent) => {
      if (!dragging.current) return;
      const a = getAngleFromEvent(ev);
      onChange(hourFromAngle(a));
    };
    const handleUp = () => {
      dragging.current = false;
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
  }, [getAngleFromEvent, onChange]);

  const needleAngle = angleFromHour(hour);
  const needleX = CENTER + NEEDLE_LENGTH * Math.cos((needleAngle * Math.PI) / 180);
  const needleY = CENTER + NEEDLE_LENGTH * Math.sin((needleAngle * Math.PI) / 180);

  return (
    <div className="flex flex-col items-center gap-1">
      <svg
        ref={svgRef}
        viewBox="0 0 100 100"
        width={size}
        height={size}
        className="cursor-pointer select-none"
        onMouseDown={handlePointerDown}
      >
        {/* Outer ring */}
        <circle cx={CENTER} cy={CENTER} r={RADIUS} fill="none" stroke="hsl(var(--border))" strokeWidth="1.5" />
        <circle cx={CENTER} cy={CENTER} r={RADIUS - 1} fill="hsl(var(--card))" fillOpacity="0.5" />

        {/* Hour ticks & labels */}
        {Array.from({ length: 24 }, (_, i) => {
          const angle = (i / 24) * 360 - 90;
          const rad = (angle * Math.PI) / 180;
          const isMajor = i % 3 === 0;
          const inner = isMajor ? TICK_INNER_MAJOR : TICK_INNER_MINOR;
          const x1 = CENTER + inner * Math.cos(rad);
          const y1 = CENTER + inner * Math.sin(rad);
          const x2 = CENTER + TICK_OUTER * Math.cos(rad);
          const y2 = CENTER + TICK_OUTER * Math.sin(rad);
          const lx = CENTER + LABEL_RADIUS * Math.cos(rad);
          const ly = CENTER + LABEL_RADIUS * Math.sin(rad);

          return (
            <g key={i}>
              <line
                x1={x1} y1={y1} x2={x2} y2={y2}
                stroke={i === hour ? 'hsl(var(--primary))' : 'hsl(var(--muted-foreground))'}
                strokeWidth={isMajor ? 1.5 : 0.5}
                strokeOpacity={isMajor ? 0.8 : 0.4}
              />
              {isMajor && (
                <text
                  x={lx} y={ly}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize="6"
                  fill={i === hour ? 'hsl(var(--primary))' : 'hsl(var(--muted-foreground))'}
                  fontWeight={i === hour ? 'bold' : 'normal'}
                  className="select-none"
                >
                  {i}
                </text>
              )}
            </g>
          );
        })}

        {/* Needle */}
        <line
          x1={CENTER} y1={CENTER}
          x2={needleX} y2={needleY}
          stroke="hsl(var(--primary))"
          strokeWidth="2"
          strokeLinecap="round"
        />

        {/* Center dot */}
        <circle cx={CENTER} cy={CENTER} r="3" fill="hsl(var(--primary))" />

        {/* Hour text center */}
        <text
          x={CENTER} y={CENTER + 14}
          textAnchor="middle"
          fontSize="7"
          fontWeight="bold"
          fill="hsl(var(--foreground))"
          className="select-none font-mono"
        >
          {hour}h
        </text>
      </svg>
    </div>
  );
};
