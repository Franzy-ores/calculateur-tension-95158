import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';

interface CalculationInfoDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  nResidentialClients: number;
  nIndustrialClients: number;
  selectedClusterName: string;
  facteurConso: number;
  facteurVE: number;
}

const getPalier = (n: number): { coeff: number; label: string } => {
  if (n <= 1) return { coeff: 1.0, label: 'n = 1' };
  if (n <= 10) return { coeff: 0.30, label: 'n = 2–10' };
  if (n <= 20) return { coeff: 0.15, label: 'n = 11–20' };
  return { coeff: 0.08, label: 'n > 20' };
};

export const CalculationInfoDialog = ({
  open,
  onOpenChange,
  nResidentialClients,
  nIndustrialClients,
  selectedClusterName,
  facteurConso,
  facteurVE,
}: CalculationInfoDialogProps) => {
  const palier = getPalier(nResidentialClients);
  const exempleBase = 21; // profil résidentiel hiver h19
  const exempleFoisonne = (exempleBase * palier.coeff).toFixed(1);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] p-0">
        <DialogHeader className="px-6 pt-6 pb-2">
          <DialogTitle className="text-base">Note de calcul — Profil 24H</DialogTitle>
          <DialogDescription className="text-xs">
            Détail du processus de calcul des tensions horaires sur le réseau BT
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="h-[65vh] px-6 pb-6">
          <div className="space-y-4 text-sm pr-3">

            {/* Paramètres actuels du projet */}
            <section>
              <h3 className="font-semibold text-sm mb-2">📊 Paramètres actuels du projet</h3>
              <div className="grid grid-cols-2 gap-2 text-xs bg-muted/50 rounded-md p-3">
                <div>Clients résidentiels liés :</div>
                <div className="font-mono font-medium">{nResidentialClients}</div>
                <div>Clients industriels liés :</div>
                <div className="font-mono font-medium">{nIndustrialClients}</div>
                <div>Cluster sélectionné :</div>
                <div className="font-medium">{selectedClusterName}</div>
                <div>Palier de foisonnement :</div>
                <div>
                  <Badge variant="outline" className="text-[10px] font-mono">
                    ×{palier.coeff} ({palier.label})
                  </Badge>
                </div>
                <div>facteurConso :</div>
                <div className="font-mono">×{facteurConso}</div>
                <div>facteurVE :</div>
                <div className="font-mono">×{facteurVE}</div>
              </div>
            </section>

            <Separator />

            {/* 1. Paramètres d'entrée */}
            <section>
              <h3 className="font-semibold text-sm mb-1">1. Paramètres d'entrée</h3>
              <ul className="text-xs space-y-1 list-disc pl-4 text-muted-foreground">
                <li><strong className="text-foreground">Nœud analysé</strong> : point du réseau où la tension est calculée</li>
                <li><strong className="text-foreground">Saison</strong> : hiver / été (profils horaires différents)</li>
                <li><strong className="text-foreground">Météo</strong> : soleil / gris (facteur PV : ×1.0 ou ×0.3)</li>
                <li><strong className="text-foreground">Cluster</strong> : modifie facteurConso et facteurVE</li>
              </ul>
            </section>

            <Separator />

            {/* 2. Profil de base */}
            <section>
              <h3 className="font-semibold text-sm mb-1">2. Profil de base</h3>
              <p className="text-xs text-muted-foreground mb-2">
                Valeurs horaires 0–23h en <strong className="text-foreground">% de la puissance contractuelle</strong>.
              </p>
              <div className="text-xs font-mono bg-muted/50 rounded-md p-3 space-y-1">
                <div><span className="text-foreground font-semibold">Résidentiel hiver</span> : pic à 21% (h19)</div>
                <div><span className="text-foreground font-semibold">Résidentiel été</span> : pic à 16.5% (h19)</div>
                <div><span className="text-foreground font-semibold">Industriel/PME</span> : pic à 100% (h10-11, h14-16)</div>
                <div><span className="text-foreground font-semibold">PV hiver</span> : pic à 65% (h12)</div>
                <div><span className="text-foreground font-semibold">PV été</span> : pic à 100% (h12)</div>
              </div>
            </section>

            <Separator />

            {/* 3. Auto-foisonnement */}
            <section>
              <h3 className="font-semibold text-sm mb-1">3. Auto-foisonnement (paliers terrain)</h3>
              <p className="text-xs text-muted-foreground mb-2">
                Le foisonnement réduit le profil de base en fonction du nombre de clients résidentiels raccordés au nœud.
              </p>
              <div className="text-xs font-mono bg-muted/50 rounded-md p-3 whitespace-pre leading-relaxed">
{`Nombre de clients (n)   Coefficient   Exemple (h19=21%)
───────────────────────  ───────────   ─────────────────
n = 1                    × 1.00        → 21.0%
n = 2 à 10               × 0.30        → 6.3%
n = 11 à 20              × 0.15        → 3.15%
n > 20                   × 0.08        → 1.68%`}
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                <strong className="text-foreground">Projet actuel</strong> : n = {nResidentialClients} → palier <strong className="text-foreground">×{palier.coeff}</strong> → profil h19 = <strong className="text-foreground">{exempleFoisonne}%</strong>
              </p>
              <p className="text-[11px] text-muted-foreground/80 mt-1 italic">
                Formule : profil_foisonné(h) = profil_base(h) × palier(n)
              </p>
            </section>

            <Separator />

            {/* 4. Cluster */}
            <section>
              <h3 className="font-semibold text-sm mb-1">4. Cluster (modificateur)</h3>
              <p className="text-xs text-muted-foreground mb-2">
                Appliqué <strong className="text-foreground">après</strong> le foisonnement, comme multiplicateur pur.
              </p>
              <div className="text-xs font-mono bg-muted/50 rounded-md p-3 whitespace-pre leading-relaxed">
{`Cluster            facteurConso   facteurVE
────────────────   ────────────   ─────────
Urbain dense       × 1.0          × 0.5
Urbain résidentiel × 1.0          × 1.0
Péri-urbain        × 1.1          × 1.5
Rural / diffus     × 1.2          × 2.0`}
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                <strong className="text-foreground">Projet actuel</strong> : {selectedClusterName} → conso ×{facteurConso}, VE ×{facteurVE}
              </p>
            </section>

            <Separator />

            {/* 5. Bonus VE */}
            <section>
              <h3 className="font-semibold text-sm mb-1">5. Bonus véhicule électrique (VE)</h3>
              <p className="text-xs text-muted-foreground mb-2">
                Ajout d'un profil de charge VE sur les heures de soirée et de nuit.
              </p>
              <div className="text-xs font-mono bg-muted/50 rounded-md p-3 whitespace-pre leading-relaxed">
{`Plage horaire   Bonus VE
──────────────  ────────
18h – 21h       + 2.5%
22h – 05h       + 5.0%`}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Le bonus VE est <strong className="text-foreground">aussi foisonné</strong> par le palier terrain, puis multiplié par le facteurVE du cluster.
              </p>
            </section>

            <Separator />

            {/* 6. Formule finale */}
            <section>
              <h3 className="font-semibold text-sm mb-1">6. Formule finale réseau</h3>
              <div className="text-xs font-mono bg-muted/50 rounded-md p-3 whitespace-pre leading-relaxed">
{`foisonnement_résidentiel(h) =
    profil_residential(h) × palier(n) × facteurConso
  + bonus_VE(h) × palier(n) × facteurVE`}
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                Ce résultat est injecté dans le calculateur électrique pour obtenir les tensions aux nœuds du réseau.
              </p>
            </section>

            <Separator />

            {/* 7. Calcul client */}
            <section>
              <h3 className="font-semibold text-sm mb-1">7. Calcul client (courbe cyan)</h3>
              <p className="text-xs text-muted-foreground">
                Utilise le profil <strong className="text-foreground">client</strong> (individuel, sans foisonnement) pour calculer la chute de tension dans le câble de branchement :
              </p>
              <div className="text-xs font-mono bg-muted/50 rounded-md p-3 mt-2 whitespace-pre leading-relaxed">
{`V_client(h) = V_nœud(h) − ΔU_branchement(h)

avec ΔU = f(P_client, câble, longueur)`}
              </div>
            </section>

          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
};
