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
import { Save, Trash2, X } from "lucide-react";

interface UnsavedChangesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: () => void;
  onDiscard: () => void;
  onCancel: () => void;
  actionDescription?: string;
}

export const UnsavedChangesDialog = ({
  open,
  onOpenChange,
  onSave,
  onDiscard,
  onCancel,
  actionDescription = "continuer"
}: UnsavedChangesDialogProps) => {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2 text-warning">
            ⚠️ Modifications non sauvées
          </AlertDialogTitle>
          <AlertDialogDescription className="text-base">
            Votre projet contient des modifications non sauvées. 
            Que souhaitez-vous faire avant de {actionDescription} ?
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="flex-col sm:flex-row gap-2">
          <Button
            variant="outline"
            onClick={() => {
              onCancel();
              onOpenChange(false);
            }}
            className="flex items-center gap-2"
          >
            <X className="h-4 w-4" />
            Annuler
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              onDiscard();
              onOpenChange(false);
            }}
            className="flex items-center gap-2"
          >
            <Trash2 className="h-4 w-4" />
            Ne pas sauver
          </Button>
          <Button
            onClick={() => {
              onSave();
              onOpenChange(false);
            }}
            className="flex items-center gap-2 bg-primary"
          >
            <Save className="h-4 w-4" />
            Sauvegarder
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
