import { ClientsPanel } from '@/components/ClientsPanel';

interface RaccordementsTabProps {
  onShowImporter?: () => void;
}

export const RaccordementsTab = ({ onShowImporter }: RaccordementsTabProps) => {
  return (
    <div className="p-2 max-h-[60vh] overflow-y-auto">
      <ClientsPanel onShowImporter={onShowImporter} />
    </div>
  );
};
