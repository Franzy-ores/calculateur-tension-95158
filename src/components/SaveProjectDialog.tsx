import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Save, FilePlus } from "lucide-react";
import { useState } from "react";

interface SaveProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentName: string;
  onSaveWithSameName: () => void;
  onSaveWithNewName: (newName: string) => void;
}

export const SaveProjectDialog = ({
  open,
  onOpenChange,
  currentName,
  onSaveWithSameName,
  onSaveWithNewName
}: SaveProjectDialogProps) => {
  const [newName, setNewName] = useState(currentName);
  const [showNewNameInput, setShowNewNameInput] = useState(false);

  const handleSaveSameName = () => {
    onSaveWithSameName();
    onOpenChange(false);
    setShowNewNameInput(false);
  };

  const handleSaveNewName = () => {
    if (newName.trim()) {
      onSaveWithNewName(newName.trim());
      onOpenChange(false);
      setShowNewNameInput(false);
    }
  };

  const handleOpenChange = (isOpen: boolean) => {
    onOpenChange(isOpen);
    if (!isOpen) {
      setShowNewNameInput(false);
      setNewName(currentName);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Save className="h-5 w-5 text-primary" />
            Sauvegarder le projet
          </DialogTitle>
          <DialogDescription>
            Comment souhaitez-vous sauvegarder votre projet ?
          </DialogDescription>
        </DialogHeader>

        {!showNewNameInput ? (
          <div className="flex flex-col gap-3 py-4">
            <Button
              onClick={handleSaveSameName}
              className="flex items-center gap-2 justify-start h-auto py-3 px-4"
              variant="outline"
            >
              <Save className="h-5 w-5 text-primary" />
              <div className="text-left">
                <div className="font-semibold">Sauvegarder sous "{currentName}"</div>
                <div className="text-xs text-muted-foreground">Conserver le nom actuel</div>
              </div>
            </Button>
            
            <Button
              onClick={() => {
                setNewName(currentName);
                setShowNewNameInput(true);
              }}
              className="flex items-center gap-2 justify-start h-auto py-3 px-4"
              variant="outline"
            >
              <FilePlus className="h-5 w-5 text-secondary" />
              <div className="text-left">
                <div className="font-semibold">Sauvegarder sous un nouveau nom</div>
                <div className="text-xs text-muted-foreground">Créer une nouvelle version</div>
              </div>
            </Button>
          </div>
        ) : (
          <div className="py-4 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="project-name">Nouveau nom du projet</Label>
              <Input
                id="project-name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Entrez le nom du projet"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleSaveNewName();
                  }
                }}
              />
            </div>
            <DialogFooter className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => setShowNewNameInput(false)}
              >
                Retour
              </Button>
              <Button
                onClick={handleSaveNewName}
                disabled={!newName.trim()}
              >
                <Save className="h-4 w-4 mr-2" />
                Sauvegarder
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
