import { useMemo } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
  ReferenceArea
} from 'recharts';
import { HourlyVoltageResult } from '@/types/dailyProfile';

interface DailyProfileChartProps {
  data: HourlyVoltageResult[];
  nominalVoltage: number;
  className?: string;
}

export const DailyProfileChart = ({ data, nominalVoltage, className }: DailyProfileChartProps) => {
  // Calculer les limites de tension (±5% et ±10%)
  const limits = useMemo(() => ({
    warning_high: nominalVoltage * 1.05,
    warning_low: nominalVoltage * 0.95,
    critical_high: nominalVoltage * 1.10,
    critical_low: nominalVoltage * 0.90
  }), [nominalVoltage]);

  // Calculer les bornes du graphe
  const { minY, maxY } = useMemo(() => {
    const allVoltages = data.flatMap(d => [d.voltageA_V, d.voltageB_V, d.voltageC_V]);
    const minVoltage = Math.min(...allVoltages, limits.critical_low);
    const maxVoltage = Math.max(...allVoltages, limits.critical_high);
    const padding = (maxVoltage - minVoltage) * 0.1;
    return {
      minY: Math.floor((minVoltage - padding) / 5) * 5,
      maxY: Math.ceil((maxVoltage + padding) / 5) * 5
    };
  }, [data, limits]);

  // Préparer les données pour Recharts
  const chartData = useMemo(() => 
    data.map(d => ({
      hour: `${d.hour}h`,
      'Phase A': Math.round(d.voltageA_V * 10) / 10,
      'Phase B': Math.round(d.voltageB_V * 10) / 10,
      'Phase C': Math.round(d.voltageC_V * 10) / 10,
      status: d.status
    })), [data]);

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      const hourData = data.find(d => `${d.hour}h` === label);
      return (
        <div className="bg-popover border border-border rounded-lg shadow-lg p-3 text-sm">
          <p className="font-semibold text-foreground mb-2">{label}</p>
          {payload.map((entry: any, index: number) => (
            <p key={index} style={{ color: entry.color }} className="flex justify-between gap-4">
              <span>{entry.name}:</span>
              <span className="font-mono font-medium">{entry.value} V</span>
            </p>
          ))}
          {hourData && (
            <p className={`mt-2 text-xs font-medium ${
              hourData.status === 'critical' ? 'text-destructive' :
              hourData.status === 'warning' ? 'text-warning' : 'text-success'
            }`}>
              Écart: {hourData.deviationPercent > 0 ? '+' : ''}{hourData.deviationPercent.toFixed(1)}%
            </p>
          )}
        </div>
      );
    }
    return null;
  };

  return (
    <div className={className}>
      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.5} />
          
          {/* Zones de référence */}
          <ReferenceArea 
            y1={limits.critical_low} 
            y2={limits.warning_low} 
            fill="hsl(var(--warning))" 
            fillOpacity={0.1} 
          />
          <ReferenceArea 
            y1={limits.warning_low} 
            y2={limits.warning_high} 
            fill="hsl(var(--success))" 
            fillOpacity={0.1} 
          />
          <ReferenceArea 
            y1={limits.warning_high} 
            y2={limits.critical_high} 
            fill="hsl(var(--warning))" 
            fillOpacity={0.1} 
          />

          <XAxis 
            dataKey="hour" 
            tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
            tickLine={{ stroke: 'hsl(var(--border))' }}
          />
          <YAxis 
            domain={[minY, maxY]}
            tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
            tickLine={{ stroke: 'hsl(var(--border))' }}
            label={{ 
              value: 'Tension (V)', 
              angle: -90, 
              position: 'insideLeft',
              style: { fill: 'hsl(var(--muted-foreground))', fontSize: 12 }
            }}
          />
          
          <Tooltip content={<CustomTooltip />} />
          <Legend 
            wrapperStyle={{ paddingTop: 10 }}
            formatter={(value) => <span className="text-foreground text-sm">{value}</span>}
          />

          {/* Lignes de référence */}
          <ReferenceLine 
            y={nominalVoltage} 
            stroke="hsl(var(--foreground))" 
            strokeDasharray="5 5" 
            strokeWidth={1}
            label={{ 
              value: `${nominalVoltage}V`, 
              position: 'right',
              fill: 'hsl(var(--muted-foreground))',
              fontSize: 10
            }}
          />
          <ReferenceLine 
            y={limits.warning_high} 
            stroke="hsl(var(--warning))" 
            strokeDasharray="3 3" 
            strokeWidth={1}
          />
          <ReferenceLine 
            y={limits.warning_low} 
            stroke="hsl(var(--warning))" 
            strokeDasharray="3 3" 
            strokeWidth={1}
          />
          <ReferenceLine 
            y={limits.critical_high} 
            stroke="hsl(var(--destructive))" 
            strokeDasharray="3 3" 
            strokeWidth={1}
          />
          <ReferenceLine 
            y={limits.critical_low} 
            stroke="hsl(var(--destructive))" 
            strokeDasharray="3 3" 
            strokeWidth={1}
          />

          {/* Courbes des 3 phases */}
          <Line 
            type="monotone" 
            dataKey="Phase A" 
            stroke="#ef4444" 
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, fill: '#ef4444' }}
          />
          <Line 
            type="monotone" 
            dataKey="Phase B" 
            stroke="#22c55e" 
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, fill: '#22c55e' }}
          />
          <Line 
            type="monotone" 
            dataKey="Phase C" 
            stroke="#3b82f6" 
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, fill: '#3b82f6' }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
};
