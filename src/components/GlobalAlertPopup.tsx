import { useState, useEffect, useCallback } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { cn } from '@/lib/utils';

type AlertType = 'surcharge' | 'injection' | null;

interface GlobalAlertPopupProps {
  transformerPower: number;
  foisonnedCharge: number;
  foisonnedProduction: number;
}

export const GlobalAlertPopup = ({
  transformerPower,
  foisonnedCharge,
  foisonnedProduction
}: GlobalAlertPopupProps) => {
  const [isVisible, setIsVisible] = useState(false);
  const [alertType, setAlertType] = useState<AlertType>(null);
  const [isClosing, setIsClosing] = useState(false);
  const [lastAlertKey, setLastAlertKey] = useState<string>('');

  // Vérifier les conditions d'alerte
  const checkAlertConditions = useCallback(() => {
    // Condition 1: Surcharge - Charges foisonnées > Puissance transfo + Productions foisonnées
    const isSurcharge = foisonnedCharge > transformerPower + foisonnedProduction;
    
    // Condition 2: Injection excessive - Productions foisonnées > Puissance transfo + Charges foisonnées
    const isInjection = foisonnedProduction > transformerPower + foisonnedCharge;
    
    // Priorité: Surcharge > Injection
    if (isSurcharge) {
      return 'surcharge' as AlertType;
    } else if (isInjection) {
      return 'injection' as AlertType;
    }
    return null;
  }, [transformerPower, foisonnedCharge, foisonnedProduction]);

  // Gérer l'affichage du popup
  useEffect(() => {
    const currentAlert = checkAlertConditions();
    const alertKey = `${currentAlert}-${transformerPower}-${foisonnedCharge.toFixed(1)}-${foisonnedProduction.toFixed(1)}`;
    
    // Si la situation a changé, réafficher le popup
    if (currentAlert && alertKey !== lastAlertKey) {
      setAlertType(currentAlert);
      setIsVisible(true);
      setIsClosing(false);
      setLastAlertKey(alertKey);
    } else if (!currentAlert) {
      // Plus d'alerte, fermer le popup
      handleClose();
    }
  }, [checkAlertConditions, transformerPower, foisonnedCharge, foisonnedProduction, lastAlertKey]);

  // Auto-fermeture après 10 secondes
  useEffect(() => {
    if (isVisible && !isClosing) {
      const timer = setTimeout(() => {
        handleClose();
      }, 10000);
      
      return () => clearTimeout(timer);
    }
  }, [isVisible, isClosing, lastAlertKey]);

  const handleClose = () => {
    setIsClosing(true);
    setTimeout(() => {
      setIsVisible(false);
      setIsClosing(false);
    }, 300);
  };

  if (!isVisible || !alertType) {
    return null;
  }

  const isSurcharge = alertType === 'surcharge';
  const borderColor = isSurcharge ? 'border-red-500' : 'border-orange-500';
  const iconColor = isSurcharge ? 'text-red-500' : 'text-orange-500';
  const conditionText = isSurcharge ? 'Surcharge détectée' : 'Injection excessive';
  const conditionColor = isSurcharge ? 'text-red-600 font-semibold' : 'text-orange-600 font-semibold';

  return (
    <div
      className={cn(
        'fixed top-20 right-4 z-[1000] w-80 bg-background border-2 rounded-lg shadow-lg transition-all duration-300',
        borderColor,
        isClosing ? 'opacity-0 translate-x-4' : 'opacity-100 translate-x-0 animate-fade-in'
      )}
    >
      {/* Header */}
      <div className={cn(
        'flex items-center justify-between px-4 py-2 border-b',
        isSurcharge ? 'bg-red-50 dark:bg-red-950/20' : 'bg-orange-50 dark:bg-orange-950/20'
      )}>
        <div className="flex items-center gap-2">
          <AlertTriangle className={cn('h-5 w-5', iconColor)} />
          <span className="font-semibold text-sm text-foreground">ALERTE GLOBALE</span>
        </div>
        <button
          onClick={handleClose}
          className="p-1 hover:bg-muted rounded transition-colors"
          aria-label="Fermer"
        >
          <X className="h-4 w-4 text-muted-foreground" />
        </button>
      </div>

      {/* Content */}
      <div className="p-4 space-y-3">
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Puissance transfo :</span>
            <span className="font-medium">{transformerPower.toFixed(0)} kVA</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Charges foisonnées :</span>
            <span className={cn('font-medium', isSurcharge && 'text-red-600')}>
              {foisonnedCharge.toFixed(1)} kVA
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Productions foisonnées :</span>
            <span className={cn('font-medium', !isSurcharge && alertType === 'injection' && 'text-orange-600')}>
              {foisonnedProduction.toFixed(1)} kVA
            </span>
          </div>
        </div>

        <div className={cn(
          'pt-2 border-t flex justify-between items-center'
        )}>
          <span className="text-sm text-muted-foreground">Condition :</span>
          <span className={conditionColor}>{conditionText}</span>
        </div>

        {/* Explication */}
        <div className="text-xs text-muted-foreground bg-muted/50 p-2 rounded">
          {isSurcharge ? (
            <>La charge foisonnée ({foisonnedCharge.toFixed(1)} kVA) dépasse la capacité disponible ({(transformerPower + foisonnedProduction).toFixed(1)} kVA).</>
          ) : (
            <>La production foisonnée ({foisonnedProduction.toFixed(1)} kVA) dépasse la capacité d'absorption ({(transformerPower + foisonnedCharge).toFixed(1)} kVA).</>
          )}
        </div>
      </div>
    </div>
  );
};
