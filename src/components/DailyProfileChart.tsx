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
import { HourlyVoltageResult, ClientHourlyVoltageResult } from '@/types/dailyProfile';

interface DailyProfileChartProps {
  data: HourlyVoltageResult[];
  comparisonData?: HourlyVoltageResult[];
  clientData?: ClientHourlyVoltageResult[];
  showNodeCurves?: boolean; // true par défaut, false pour mode "courbe seule"
  nominalVoltage: number;
  className?: string;
}

export const DailyProfileChart = ({ data, comparisonData, clientData, showNodeCurves = true, nominalVoltage, className }: DailyProfileChartProps) => {
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
    const comparisonVoltages = comparisonData?.flatMap(d => [d.voltageA_V, d.voltageB_V, d.voltageC_V]) || [];
    const clientVoltages = clientData?.map(d => d.voltageClient_V) || [];
    const minVoltage = Math.min(...allVoltages, ...comparisonVoltages, ...clientVoltages, limits.critical_low);
    const maxVoltage = Math.max(...allVoltages, ...comparisonVoltages, ...clientVoltages, limits.critical_high);
    const padding = (maxVoltage - minVoltage) * 0.1;
    return {
      minY: Math.floor((minVoltage - padding) / 5) * 5,
      maxY: Math.ceil((maxVoltage + padding) / 5) * 5
    };
  }, [data, comparisonData, clientData, limits]);

  // Préparer les données pour Recharts
  const chartData = useMemo(() => 
    data.map((d, i) => {
      const base: Record<string, any> = {
        hour: `${d.hour}h`,
        'Phase A': Math.round(d.voltageA_V * 10) / 10,
        'Phase B': Math.round(d.voltageB_V * 10) / 10,
        'Phase C': Math.round(d.voltageC_V * 10) / 10,
        status: d.status
      };
      
      if (comparisonData?.[i]) {
        base['Phase A (base)'] = Math.round(comparisonData[i].voltageA_V * 10) / 10;
        base['Phase B (base)'] = Math.round(comparisonData[i].voltageB_V * 10) / 10;
        base['Phase C (base)'] = Math.round(comparisonData[i].voltageC_V * 10) / 10;
      }
      
      if (clientData?.[i]) {
        base['Point client'] = Math.round(clientData[i].voltageClient_V * 10) / 10;
        base['clientDeltaU'] = Math.round(clientData[i].deltaU_V * 100) / 100;
        base['clientFoisonnement'] = clientData[i].foisonnementApplied;
      }
      
      return base;
    }), [data, comparisonData, clientData]);

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      const hourData = data.find(d => `${d.hour}h` === label);
      const simData = payload.filter((p: any) => !p.name.includes('(base)') && p.name !== 'Point client');
      const baseData = payload.filter((p: any) => p.name.includes('(base)'));
      const clientEntry = payload.find((p: any) => p.name === 'Point client');
      
      return (
        <div className="bg-popover border border-border rounded-lg shadow-lg p-3 text-sm">
          <p className="font-semibold text-foreground mb-2">{label}</p>
          
          {/* Valeurs des phases réseau */}
          {baseData.length > 0 && (
            <p className="text-xs text-muted-foreground mb-1">Avec simulation:</p>
          )}
          {simData.map((entry: any, index: number) => (
            <p key={index} style={{ color: entry.color }} className="flex justify-between gap-4">
              <span>{entry.name}:</span>
              <span className="font-mono font-medium">{entry.value} V</span>
            </p>
          ))}
          
          {/* Courbe client */}
          {clientEntry && (
            <div className="border-t border-cyan-500/30 mt-2 pt-2">
              <p style={{ color: clientEntry.color }} className="flex justify-between gap-4 font-medium">
                <span>{clientEntry.name}:</span>
                <span className="font-mono">{clientEntry.value} V</span>
              </p>
              {clientData && (
                <p className="text-xs text-muted-foreground mt-1">
                  ΔU câble: {chartData.find(d => d.hour === label)?.clientDeltaU?.toFixed(2) || '-'} V
                </p>
              )}
            </div>
          )}
          
          {/* Valeurs sans simulation (comparaison) */}
          {baseData.length > 0 && (
            <div className="border-t border-border mt-2 pt-2">
              <p className="text-xs text-muted-foreground mb-1">Réseau de base:</p>
              {baseData.map((entry: any, index: number) => (
                <p key={index} style={{ color: entry.color }} className="flex justify-between gap-4 opacity-70">
                  <span>{entry.name.replace(' (base)', '')}:</span>
                  <span className="font-mono font-medium">{entry.value} V</span>
                </p>
              ))}
            </div>
          )}
          
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

          {/* Courbes des 3 phases (avec simulation) - masquées si showNodeCurves=false */}
          {showNodeCurves && (
            <>
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
            </>
          )}
          
          {/* Courbes de comparaison (réseau de base, pointillés) - masquées si showNodeCurves=false */}
          {showNodeCurves && comparisonData && comparisonData.length > 0 && (
            <>
              <Line 
                type="monotone" 
                dataKey="Phase A (base)" 
                stroke="#ef4444" 
                strokeWidth={1.5}
                strokeDasharray="5 5"
                strokeOpacity={0.5}
                dot={false}
              />
              <Line 
                type="monotone" 
                dataKey="Phase B (base)" 
                stroke="#22c55e" 
                strokeWidth={1.5}
                strokeDasharray="5 5"
                strokeOpacity={0.5}
                dot={false}
              />
              <Line 
                type="monotone" 
                dataKey="Phase C (base)" 
                stroke="#3b82f6" 
                strokeWidth={1.5}
                strokeDasharray="5 5"
                strokeOpacity={0.5}
                dot={false}
              />
            </>
          )}
          
          {/* Courbe point client (cyan) - épaisseur 2× */}
          {clientData && clientData.length > 0 && (
            <Line 
              type="monotone" 
              dataKey="Point client" 
              stroke="#06b6d4"
              strokeWidth={5}
              dot={false}
              activeDot={{ r: 6, fill: '#06b6d4' }}
            />
          )}
        </LineChart>
      </ResponsiveContainer>
      
      {/* Légendes supplémentaires */}
      {(comparisonData?.length || clientData?.length) && (
        <div className="flex items-center justify-center gap-6 mt-2 text-xs text-muted-foreground flex-wrap">
          {comparisonData && comparisonData.length > 0 && (
            <>
              <span className="flex items-center gap-2">
                <span className="w-6 h-0.5 bg-foreground"></span>
                Avec simulation
              </span>
              <span className="flex items-center gap-2">
                <span className="w-6 h-0.5 border-t-2 border-dashed border-foreground opacity-50"></span>
                Réseau de base
              </span>
            </>
          )}
          {clientData && clientData.length > 0 && (
            <span className="flex items-center gap-2">
              <span className="w-6 h-0.5 bg-cyan-500"></span>
              Point client
            </span>
          )}
        </div>
      )}
    </div>
  );
};
