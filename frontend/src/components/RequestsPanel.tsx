import { useState } from 'react';
import { toast } from 'react-hot-toast';
import type { Constraint, Camper, ConstraintType } from '../types/app-types';
import RequestForm from './RequestForm';

interface RequestsPanelProps {
  sessionId: string;
  constraints: Constraint[];
  campers: Camper[];
  onConstraintCreate: (constraint: Partial<Constraint>) => Promise<void>;
  onConstraintUpdate: (id: string, updates: Partial<Constraint>) => Promise<void>;
  onConstraintDelete: (id: string) => Promise<void>;
}

export default function RequestsPanel({
  sessionId,
  constraints,
  campers,
  onConstraintCreate,
  onConstraintUpdate,
  onConstraintDelete,
}: RequestsPanelProps) {
  const [isCreating, setIsCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const handleCreate = async (data: Partial<Constraint>) => {
    try {
      await onConstraintCreate({
        ...data,
        session: sessionId,
      });
      setIsCreating(false);
      toast.success('Constraint created');
    } catch {
      toast.error('Failed to create constraint');
    }
  };

  const handleUpdate = async (id: string, data: Partial<Constraint>) => {
    try {
      await onConstraintUpdate(id, data);
      setEditingId(null);
      toast.success('Request updated');
    } catch {
      toast.error('Failed to update request');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this request?')) {
      return;
    }

    try {
      await onConstraintDelete(id);
      toast.success('Request deleted');
    } catch {
      toast.error('Failed to delete request');
    }
  };

  const getConstraintIcon = (type: ConstraintType) => {
    switch (type) {
      case 'pair_together':
        return '👫';
      case 'keep_apart':
        return '🚫';
      case 'age_preference':
        return '📅';
      case 'bunk_preference':
        return '🏠';
      default:
        return '📌';
    }
  };

  const getConstraintDescription = (constraint: Constraint) => {
    const camperNames = constraint.expand?.campers?.map(c => c.name) || [];
    const constraintType = constraint.type || constraint.constraint_type;
    
    switch (constraintType) {
      case 'pair_together':
        return `${camperNames.join(' and ')} should bunk together`;
      case 'keep_apart':
        return `Keep ${camperNames.join(', ')} in different bunks`;
      case 'age_preference': {
        const pref = constraint.metadata?.['preference'] || 'similar';
        return `${camperNames[0]} prefers ${pref} age campers`;
      }
      case 'bunk_preference': {
        const bunkName = constraint.metadata?.['bunkName'] || 'specific bunk';
        return `${camperNames[0]} prefers ${bunkName}`;
      }
      default:
        return 'Unknown constraint';
    }
  };


  return (
    <div className="bg-white rounded-lg shadow-sm border p-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-semibold">Bunking Requests</h2>
        <button
          onClick={() => setIsCreating(true)}
          className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
        >
          Add Request
        </button>
      </div>

      {/* Constraint List */}
      <div className="space-y-3">
        {constraints.length === 0 && !isCreating && (
          <p className="text-gray-500 text-center py-8">
            No bunking requests defined. Add some to guide the optimizer!
          </p>
        )}

        {/* Create Form */}
        {isCreating && (
          <div className="border rounded-lg p-4 bg-gray-50">
            <RequestForm
              campers={campers}
              onSubmit={handleCreate}
              onCancel={() => setIsCreating(false)}
            />
          </div>
        )}

        {/* Existing Requests */}
        {constraints.map(constraint => (
          <div
            key={constraint.id}
            className="border rounded-lg p-4 hover:shadow-sm transition-shadow"
          >
            {editingId === constraint.id ? (
              <RequestForm
                campers={campers}
                constraint={constraint}
                onSubmit={(data) => handleUpdate(constraint.id, data)}
                onCancel={() => setEditingId(null)}
              />
            ) : (
              <div className="flex items-center justify-between">
                <div className="flex items-start space-x-3">
                  <span className="text-2xl" role="img" aria-label={constraint.type || constraint.constraint_type}>
                    {getConstraintIcon((constraint.type || constraint.constraint_type) as ConstraintType)}
                  </span>
                  <div>
                    <p className="font-medium">
                      {getConstraintDescription(constraint)}
                    </p>
                    <div className="flex items-center space-x-2 mt-1">
                      <span className="text-xs px-2 py-1 rounded-full bg-blue-100 text-blue-800">
                        {constraint.severity || 'soft'}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center space-x-2">
                  <button
                    onClick={() => setEditingId(constraint.id)}
                    className="p-2 text-gray-600 hover:bg-gray-100 rounded-md"
                    title="Edit constraint"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                    </svg>
                  </button>
                  <button
                    onClick={() => handleDelete(constraint.id)}
                    className="p-2 text-red-600 hover:bg-red-50 rounded-md"
                    title="Delete constraint"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Help Text */}
      <div className="mt-6 p-4 bg-blue-50 rounded-lg">
        <h3 className="font-medium text-blue-900 mb-2">About Constraints</h3>
        <ul className="text-sm text-blue-800 space-y-1">
          <li>• <strong>Pair Together:</strong> Ensures two campers are placed in the same bunk</li>
          <li>• <strong>Keep Apart:</strong> Prevents campers from being in the same bunk</li>
          <li>• <strong>Age Preference:</strong> Tries to place camper with similar/older/younger campers</li>
          <li>• <strong>Priority:</strong> Higher priority constraints are satisfied first (5 is highest)</li>
        </ul>
      </div>
    </div>
  );
}