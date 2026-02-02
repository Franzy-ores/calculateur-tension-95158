import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { FolderOpen, Trash2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";

interface RecoveryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectName: string;
  savedAt: string;
  onRecover: () => void;
  onDiscard: () => void;
}

export const RecoveryDialog = ({
  open,
  onOpenChange,
  projectName,
  savedAt,
  onRecover,
  onDiscard
}: RecoveryDialogProps) => {
  const formattedTime = (() => {
    try {
      return formatDistanceToNow(new Date(savedAt), { 
        addSuffix: true, 
        locale: fr 
      });
    } catch {
      return "récemment";
    }
  })();

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2 text-primary">
            📂 Récupération de projet
          </AlertDialogTitle>
          <AlertDialogDescription className="text-base space-y-2">
            <p>Un brouillon non sauvé a été détecté :</p>
            <div className="bg-muted p-3 rounded-lg mt-2">
              <p className="font-semibold text-foreground">{projectName}</p>
              <p className="text-sm text-muted-foreground">
                Dernière modification : {formattedTime}
              </p>
            </div>
            <p className="mt-3">Souhaitez-vous le récupérer ?</p>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="flex-col sm:flex-row gap-2">
          <Button
            variant="destructive"
            onClick={() => {
              onDiscard();
              onOpenChange(false);
            }}
            className="flex items-center gap-2"
          >
            <Trash2 className="h-4 w-4" />
            Ignorer et supprimer
          </Button>
          <Button
            onClick={() => {
              onRecover();
              onOpenChange(false);
            }}
            className="flex items-center gap-2 bg-primary"
          >
            <FolderOpen className="h-4 w-4" />
            Récupérer
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
