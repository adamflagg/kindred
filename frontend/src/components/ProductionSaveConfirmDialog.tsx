import { useState } from 'react';
import { X, AlertTriangle, FlaskConical, ArrowRight } from 'lucide-react';

interface ProductionSaveConfirmDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  onCreateScenario: () => void;
}

export default function ProductionSaveConfirmDialog({ 
  isOpen, 
  onClose, 
  onConfirm, 
  onCreateScenario 
}: ProductionSaveConfirmDialogProps) {
  const [understanding, setUnderstanding] = useState(false);

  if (!isOpen) return null;

  const handleCreateScenario = () => {
    onClose();
    onCreateScenario();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      
      {/* Modal */}
      <div className="relative bg-card rounded-xl shadow-xl border border-border p-6 w-full max-w-lg mx-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-6 w-6 text-yellow-600" />
            <h2 className="text-xl font-bold">Production Mode Warning</h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-muted rounded-lg transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        
        <div className="space-y-4">
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
            <p className="text-sm text-yellow-800">
              <strong>Important:</strong> You are about to save changes in production mode. 
              These changes will be <strong>overwritten</strong> during the next sync from CampMinder.
            </p>
          </div>

          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              To preserve your changes permanently, you should:
            </p>
            <ul className="space-y-2 text-sm">
              <li className="flex items-start gap-2">
                <span className="text-primary">•</span>
                <span>Lock individual assignments that must be preserved</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-primary">•</span>
                <span>Create a scenario to work in a safe environment</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-primary">•</span>
                <span>Export your final assignments before the next sync</span>
              </li>
            </ul>
          </div>

          <div className="flex items-start gap-2 p-3 bg-muted rounded-lg">
            <input
              id="understanding"
              type="checkbox"
              checked={understanding}
              onChange={(e) => setUnderstanding(e.target.checked)}
              className="h-4 w-4 rounded border-input bg-background text-primary focus:ring-2 focus:ring-primary mt-0.5"
            />
            <label htmlFor="understanding" className="text-sm cursor-pointer">
              I understand that my changes may be lost during the next sync
            </label>
          </div>
        </div>
        
        <div className="flex gap-3 mt-6">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 bg-muted hover:bg-muted/80 rounded-lg font-medium transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleCreateScenario}
            className="flex-1 px-4 py-2 bg-yellow-600 hover:bg-yellow-700 text-white rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
          >
            <FlaskConical className="h-4 w-4" />
            Create Scenario
          </button>
          <button
            onClick={onConfirm}
            disabled={!understanding}
            className="flex-1 px-4 py-2 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            Proceed Anyway
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}