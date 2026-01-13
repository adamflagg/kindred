import React, { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Listbox, ListboxButton, ListboxOptions, ListboxOption } from '@headlessui/react';
import type { Constraint, Camper, ConstraintType } from '../types/app-types';
import { formatGradeOrdinal } from '../utils/gradeUtils';
import { getDisplayAgeForYear } from '../utils/displayAge';
import { useYear } from '../hooks/useCurrentYear';

interface RequestFormProps {
  campers: Camper[];
  constraint?: Constraint;
  onSubmit: (data: Partial<Constraint>) => void;
  onCancel: () => void;
}

export default function RequestForm({
  campers,
  constraint,
  onSubmit,
  onCancel,
}: RequestFormProps) {
  const viewingYear = useYear();
  const [type, setType] = useState<ConstraintType>(
    constraint?.type || 'pair_together'
  );
  const [selectedCampers, setSelectedCampers] = useState<string[]>(
    constraint?.campers || []
  );
  const [metadata, setMetadata] = useState<Record<string, unknown>>(constraint?.metadata || {});

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (selectedCampers.length === 0) {
      alert('Please select at least one camper');
      return;
    }

    if (type === 'pair_together' && selectedCampers.length !== 2) {
      alert('Pair together request requires exactly 2 campers');
      return;
    }

    if (type === 'keep_apart' && selectedCampers.length < 2) {
      alert('Keep apart request requires at least 2 campers');
      return;
    }

    onSubmit({
      type,
      campers: selectedCampers,
      metadata,
    });
  };

  const toggleCamper = (camperId: string) => {
    setSelectedCampers(prev =>
      prev.includes(camperId)
        ? prev.filter(id => id !== camperId)
        : [...prev, camperId]
    );
  };

  const getMaxCampers = () => {
    switch (type) {
      case 'pair_together':
        return 2;
      case 'age_preference':
      case 'bunk_preference':
        return 1;
      default:
        return 10;
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Constraint Type */}
      <div>
        <label className="block text-sm font-medium text-foreground mb-1">
          Constraint Type
        </label>
        <Listbox
          value={type}
          onChange={(v) => {
            setType(v as ConstraintType);
            setSelectedCampers([]); // Reset selection on type change
          }}
        >
          <div className="relative">
            <ListboxButton className="listbox-button">
              <span>
                {type === 'pair_together' ? 'Pair Together' :
                 type === 'keep_apart' ? 'Keep Apart' :
                 type === 'age_preference' ? 'Age Preference' : 'Bunk Preference'}
              </span>
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            </ListboxButton>
            <ListboxOptions className="listbox-options w-full">
              <ListboxOption value="pair_together" className="listbox-option">Pair Together</ListboxOption>
              <ListboxOption value="keep_apart" className="listbox-option">Keep Apart</ListboxOption>
              <ListboxOption value="age_preference" className="listbox-option">Age Preference</ListboxOption>
              <ListboxOption value="bunk_preference" className="listbox-option">Bunk Preference</ListboxOption>
            </ListboxOptions>
          </div>
        </Listbox>
      </div>

      {/* Camper Selection */}
      <div>
        <label className="block text-sm font-medium text-foreground mb-1">
          Select Campers ({selectedCampers.length}/{getMaxCampers()})
        </label>
        <div className="border rounded-md p-2 max-h-48 overflow-y-auto bg-background">
          {campers.map(camper => (
            <label
              key={camper.id}
              className="flex items-center p-2 hover:bg-muted/50 cursor-pointer transition-colors duration-75"
            >
              <input
                type="checkbox"
                checked={selectedCampers.includes(camper.id)}
                onChange={() => toggleCamper(camper.id)}
                disabled={
                  !selectedCampers.includes(camper.id) &&
                  selectedCampers.length >= getMaxCampers()
                }
                className="mr-3 w-5 h-5 sm:w-4 sm:h-4 cursor-pointer"
              />
              <div className="flex-1">
                <span className="font-medium">{camper.name}</span>
                <span className="text-sm text-muted-foreground ml-2">
                  Age {(getDisplayAgeForYear(camper, viewingYear) ?? 0).toFixed(2)} • {formatGradeOrdinal(camper.grade)}
                </span>
              </div>
            </label>
          ))}
        </div>
      </div>

      {/* Type-specific fields */}
      {type === 'age_preference' && (
        <div>
          <label className="block text-sm font-medium text-foreground mb-1">
            Age Preference
          </label>
          <Listbox
            value={(metadata['preference'] as string) || 'similar'}
            onChange={(v) => setMetadata({ ...metadata, preference: v })}
          >
            <div className="relative">
              <ListboxButton className="listbox-button">
                <span>
                  {(metadata['preference'] as string) === 'older' ? 'Older Campers' :
                   (metadata['preference'] as string) === 'younger' ? 'Younger Campers' : 'Similar Age'}
                </span>
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              </ListboxButton>
              <ListboxOptions className="listbox-options w-full">
                <ListboxOption value="similar" className="listbox-option">Similar Age</ListboxOption>
                <ListboxOption value="older" className="listbox-option">Older Campers</ListboxOption>
                <ListboxOption value="younger" className="listbox-option">Younger Campers</ListboxOption>
              </ListboxOptions>
            </div>
          </Listbox>
        </div>
      )}

      {type === 'bunk_preference' && (
        <div>
          <label className="block text-sm font-medium text-foreground mb-1">
            Preferred Bunk Name (optional)
          </label>
          <input
            type="text"
            value={(metadata['bunkName'] as string) || ''}
            onChange={(e) =>
              setMetadata({ ...metadata, bunkName: e.target.value })
            }
            placeholder="e.g., B-10 or Teen 1"
            className="w-full px-3 py-2 border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
      )}

      {/* Actions */}
      <div className="flex justify-end space-x-2 pt-2">
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 border rounded-md hover:bg-muted/50 transition-colors duration-75"
        >
          Cancel
        </button>
        <button
          type="submit"
          className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors duration-75"
        >
          {constraint ? 'Update' : 'Create'} Constraint
        </button>
      </div>
    </form>
  );
}