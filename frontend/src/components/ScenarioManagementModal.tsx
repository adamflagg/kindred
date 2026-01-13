import { useState } from 'react';
import { Edit, Trash2, RotateCcw, Plus, FlaskConical, Package, Calendar } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { useScenario } from '../hooks/useScenario';
import { useYear } from '../hooks/useCurrentYear';
import { useSyncStatusAPI } from '../hooks/useSyncStatusAPI';
import ScenarioEditModal from './ScenarioEditModal';
import NewScenarioModal from './NewScenarioModal';
import { Modal } from './ui/Modal';
import { toast } from 'react-hot-toast';

interface Scenario {
  id: string;
  name: string;
  session_cm_id: number;
  created_by?: string;
  created?: string;
  updated?: string;
  is_active: boolean;
  description?: string;
}

interface ScenarioManagementModalProps {
  sessionId: number;
  onClose: () => void;
}

export default function ScenarioManagementModal({ sessionId, onClose }: ScenarioManagementModalProps) {
  const currentYear = useYear();
  const {
    scenarios,
    currentScenario,
    selectScenario,
    updateScenario,
    deleteScenario,
    clearScenario,
    loading
  } = useScenario();
  const { data: syncStatus } = useSyncStatusAPI();

  const [editingScenario, setEditingScenario] = useState<Scenario | null>(null);
  const [showNewScenarioModal, setShowNewScenarioModal] = useState(false);
  const [confirmAction, setConfirmAction] = useState<{ type: 'delete' | 'clear'; scenario: Scenario } | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const formatDate = (dateString?: string) => {
    if (!dateString) return 'Unknown';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const handleDelete = async (scenario: Scenario) => {
    setIsProcessing(true);
    try {
      await deleteScenario(scenario.id);
      toast.success(`Deleted scenario: ${scenario.name}`);
      setConfirmAction(null);
    } catch {
      toast.error('Failed to delete scenario');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleClear = async (scenario: Scenario) => {
    setIsProcessing(true);
    try {
      await clearScenario(scenario.id, currentYear);
      toast.success(`Cleared assignments in: ${scenario.name}`);
      setConfirmAction(null);
    } catch {
      toast.error('Failed to clear scenario');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleUpdate = async (scenarioId: string, updates: { name?: string; description?: string }) => {
    await updateScenario(scenarioId, updates);
    toast.success('Scenario updated');
  };

  const headerContent = (
    <div className="p-6 pr-14 border-b border-border">
      <h2 className="text-2xl font-display font-bold">Manage Scenarios</h2>
    </div>
  );

  const footerContent = (
    <div className="p-6 border-t border-border">
      <button
        onClick={() => setShowNewScenarioModal(true)}
        className="btn-primary w-full py-3 flex items-center justify-center gap-2"
      >
        <Plus className="h-5 w-5" />
        Create New Scenario
      </button>
    </div>
  );

  return (
    <>
      <Modal
        isOpen={true}
        onClose={onClose}
        header={headerContent}
        footer={footerContent}
        size="lg"
        noPadding
      >
        <div className="flex flex-col max-h-[60vh]">
          {/* Production Mode Card */}
          <div className="p-6 pb-0">
            <div
              className={`p-4 rounded-xl border-2 ${
                !currentScenario
                  ? 'border-primary bg-primary/5'
                  : 'border-border bg-muted/30 hover:bg-muted/50'
              } cursor-pointer transition-all`}
              onClick={() => selectScenario(null)}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Package className="h-5 w-5 text-primary" />
                  <div>
                    <h3 className="font-semibold">CampMinder</h3>
                    <p className="text-sm text-muted-foreground">
                      {syncStatus?.bunk_assignments?.end_time
                        ? `Synced ${formatDistanceToNow(new Date(syncStatus.bunk_assignments.end_time), { addSuffix: true })}`
                        : 'Production bunking assignments'}
                    </p>
                  </div>
                </div>
                {!currentScenario && (
                  <div className="px-3 py-1 bg-primary/10 text-primary rounded-xl text-sm font-medium">
                    Active
                  </div>
                )}
              </div>
            </div>
          </div>
          
          {/* Scenarios List */}
          <div className="flex-1 overflow-y-auto space-y-3 p-6 pt-4">
            {loading ? (
              <div className="text-center py-8 text-muted-foreground">Loading scenarios...</div>
            ) : scenarios.length === 0 ? (
              <div className="text-center py-8">
                <FlaskConical className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
                <p className="text-muted-foreground">No draft scenarios yet</p>
                <p className="text-sm text-muted-foreground mt-1">Create a scenario to experiment with different bunking arrangements</p>
              </div>
            ) : (
              scenarios.map((scenario) => (
                <div
                  key={scenario.id}
                  className={`p-4 rounded-xl border-2 ${
                    currentScenario?.id === scenario.id
                      ? 'border-accent bg-accent/5'
                      : 'border-border bg-muted/30 hover:bg-muted/50'
                  } transition-all`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div
                      className="flex-1 cursor-pointer"
                      onClick={() => selectScenario(scenario.id)}
                    >
                      <div className="flex items-center gap-3 mb-1">
                        <FlaskConical className="h-5 w-5 text-accent" />
                        <h3 className="font-semibold">{scenario.name}</h3>
                        {currentScenario?.id === scenario.id && (
                          <div className="px-3 py-1 bg-accent/10 text-accent rounded-xl text-sm font-medium">
                            Active
                          </div>
                        )}
                      </div>
                      {scenario.description && (
                        <p className="text-sm text-muted-foreground mb-2">{scenario.description}</p>
                      )}
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Calendar className="h-3 w-3" />
                        <span>Created {formatDate(scenario.created)}</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setEditingScenario(scenario)}
                        className="btn-ghost p-2"
                        title="Edit scenario"
                      >
                        <Edit className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => setConfirmAction({ type: 'clear', scenario })}
                        className="btn-ghost p-2"
                        title="Clear assignments"
                      >
                        <RotateCcw className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => setConfirmAction({ type: 'delete', scenario })}
                        className="p-2 rounded-xl hover:bg-destructive/10 text-destructive transition-colors"
                        title="Delete scenario"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </Modal>

      {/* Confirmation Dialog */}
      <Modal
        isOpen={!!confirmAction}
        onClose={() => setConfirmAction(null)}
        title={confirmAction?.type === 'delete' ? 'Delete Scenario?' : 'Clear Assignments?'}
        size="sm"
      >
        {confirmAction && (
          <>
            <p className="text-muted-foreground mb-6">
              {confirmAction.type === 'delete'
                ? `Are you sure you want to delete "${confirmAction.scenario.name}"? This action cannot be undone.`
                : `Are you sure you want to clear all assignments in "${confirmAction.scenario.name}"? This action cannot be undone.`
              }
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmAction(null)}
                className="btn-ghost flex-1 py-2"
                disabled={isProcessing}
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (confirmAction.type === 'delete') {
                    handleDelete(confirmAction.scenario);
                  } else {
                    handleClear(confirmAction.scenario);
                  }
                }}
                className="flex-1 px-4 py-2.5 bg-destructive hover:bg-destructive/90 text-destructive-foreground rounded-xl font-semibold transition-all shadow-lodge disabled:opacity-50"
                disabled={isProcessing}
              >
                {isProcessing
                  ? (confirmAction.type === 'delete' ? 'Deleting...' : 'Clearing...')
                  : (confirmAction.type === 'delete' ? 'Delete' : 'Clear')
                }
              </button>
            </div>
          </>
        )}
      </Modal>
      
      {/* Edit Modal */}
      {editingScenario && (
        <ScenarioEditModal
          scenario={editingScenario}
          onClose={() => setEditingScenario(null)}
          onSave={handleUpdate}
        />
      )}
      
      {/* New Scenario Modal */}
      {showNewScenarioModal && (
        <NewScenarioModal
          sessionId={sessionId}
          onClose={() => setShowNewScenarioModal(false)}
          onScenarioCreated={(scenario) => {
            setShowNewScenarioModal(false);
            toast.success(`Created scenario: ${scenario.name}`);
          }}
        />
      )}
    </>
  );
}