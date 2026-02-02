import { useState, useRef, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

interface CompactHourlySliderProps {
  hour: number;
  value: number;
  onChange: (value: number) => void;
}

export const CompactHourlySlider = ({ hour, value, onChange }: CompactHourlySliderProps) => {
  const [isDragging, setIsDragging] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(value.toString());
  const barRef = useRef<HTMLDivElement>(null);

  const getIntensityColor = (val: number) => {
    if (val < 30) return 'bg-green-500';
    if (val < 60) return 'bg-yellow-500';
    if (val < 80) return 'bg-orange-500';
    return 'bg-red-500';
  };

  const calculateValueFromPosition = useCallback((clientX: number) => {
    if (!barRef.current) return value;
    const rect = barRef.current.getBoundingClientRect();
    const x = clientX - rect.left;
    const percentage = Math.max(0, Math.min(100, (x / rect.width) * 100));
    return Math.round(percentage);
  }, [value]);

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    const newValue = calculateValueFromPosition(e.clientX);
    onChange(newValue);
  };

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isDragging) return;
    const newValue = calculateValueFromPosition(e.clientX);
    onChange(newValue);
  }, [isDragging, calculateValueFromPosition, onChange]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  // Add/remove global listeners for drag
  useState(() => {
    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };
    }
  });

  const handleSaveEdit = () => {
    const newValue = Math.max(0, Math.min(100, parseInt(editValue) || 0));
    onChange(newValue);
    setIsEditing(false);
  };

  return (
    <div className="flex items-center gap-1.5 py-0.5">
      {/* Hour label */}
      <span className="w-7 text-[10px] font-medium text-muted-foreground shrink-0">
        {hour.toString().padStart(2, '0')}h
      </span>
      
      {/* Progress bar - clickable/draggable */}
      <div
        ref={barRef}
        className="flex-1 h-4 bg-secondary rounded-sm cursor-pointer relative overflow-hidden select-none"
        onMouseDown={handleMouseDown}
      >
        <div
          className={cn('h-full transition-all', getIntensityColor(value))}
          style={{ width: `${value}%` }}
        />
        {/* Hover indicator */}
        <div className="absolute inset-0 hover:bg-foreground/5 transition-colors" />
      </div>
      
      {/* Value with click-to-edit */}
      <Popover open={isEditing} onOpenChange={setIsEditing}>
        <PopoverTrigger asChild>
          <button 
            className="w-8 text-[10px] font-medium text-right hover:text-primary transition-colors shrink-0"
            onClick={() => {
              setEditValue(value.toString());
              setIsEditing(true);
            }}
          >
            {value}%
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-32 p-2" side="top">
          <div className="flex flex-col gap-2">
            <Input
              type="number"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              min={0}
              max={100}
              className="h-7 text-xs text-center"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSaveEdit();
                if (e.key === 'Escape') setIsEditing(false);
              }}
            />
            <Button size="sm" className="h-6 text-xs" onClick={handleSaveEdit}>
              OK
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
};
