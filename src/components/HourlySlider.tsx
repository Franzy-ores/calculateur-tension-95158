import { Slider } from '@/components/ui/slider';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

interface HourlySliderProps {
  hour: number;
  value: number;
  onChange: (value: number) => void;
  color?: string;
}

export const HourlySlider = ({ hour, value, onChange, color = 'bg-primary' }: HourlySliderProps) => {
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = Math.max(0, Math.min(100, Number(e.target.value) || 0));
    onChange(newValue);
  };

  const getIntensityColor = (val: number) => {
    if (val < 30) return 'bg-green-500';
    if (val < 60) return 'bg-yellow-500';
    if (val < 80) return 'bg-orange-500';
    return 'bg-red-500';
  };

  return (
    <div className="flex items-center gap-2 py-1">
      <span className="w-8 text-xs font-medium text-muted-foreground">
        {hour.toString().padStart(2, '0')}h
      </span>
      
      <div className="flex-1 relative">
        <Slider
          value={[value]}
          onValueChange={([v]) => onChange(v)}
          max={100}
          step={1}
          className="w-full"
        />
      </div>
      
      <div className={cn('w-2 h-4 rounded-sm', getIntensityColor(value))} />
      
      <Input
        type="number"
        value={value}
        onChange={handleInputChange}
        min={0}
        max={100}
        className="w-14 h-7 text-xs text-center p-1"
      />
      <span className="text-xs text-muted-foreground w-4">%</span>
    </div>
  );
};
