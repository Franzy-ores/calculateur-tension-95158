import { AreaChart, Area, XAxis, YAxis, ResponsiveContainer, ReferenceLine } from 'recharts';

interface ProfilePreviewChartProps {
  values: number[];
  color?: string;
  label?: string;
}

export const ProfilePreviewChart = ({ values, color = '#3b82f6', label }: ProfilePreviewChartProps) => {
  const data = values.map((value, hour) => ({
    hour: `${hour}h`,
    value,
  }));

  return (
    <div className="w-full">
      {label && (
        <p className="text-xs text-muted-foreground mb-1 text-center">{label}</p>
      )}
      <ResponsiveContainer width="100%" height={120}>
        <AreaChart data={data} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
          <defs>
            <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={color} stopOpacity={0.3} />
              <stop offset="95%" stopColor={color} stopOpacity={0.05} />
            </linearGradient>
          </defs>
          <XAxis 
            dataKey="hour" 
            tick={{ fontSize: 9 }} 
            tickLine={false}
            axisLine={{ stroke: 'hsl(var(--border))' }}
            interval={3}
          />
          <YAxis 
            domain={[0, 100]} 
            tick={{ fontSize: 9 }} 
            tickLine={false}
            axisLine={{ stroke: 'hsl(var(--border))' }}
            tickFormatter={(v) => `${v}%`}
          />
          <ReferenceLine y={50} stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" opacity={0.3} />
          <Area
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={2}
            fill="url(#colorValue)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
};
