import { useState } from "react";
import { Button } from "../components/ui/Button";
import { Modal } from "../components/ui/Modal";
import { TextInput } from "../components/ui/TextInput";

type Props = {
  site: string;
  onCancel: () => void;
  onConfirm: () => void;
};

export function DeleteEntryModal({ site, onCancel, onConfirm }: Props) {
  const [confirmation, setConfirmation] = useState("");

  return (
    <Modal
      title="Delete Entry"
      onClose={onCancel}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            variant="danger"
            disabled={confirmation !== "DELETE"}
            onClick={onConfirm}
          >
            Delete Entry
          </Button>
        </>
      }
    >
      <p className="text-[13px] text-pf-text-secondary">
        Delete entry parameters for <span className="font-mono text-pf-text-primary">{site}</span>?
        Generated passwords cannot be recovered without exact parameters.
      </p>
      <label className="mb-1 mt-4 block text-[13px] font-medium text-pf-text-secondary">
        Type <span className="font-mono text-pf-text-error">DELETE</span> to confirm
      </label>
      <TextInput
        value={confirmation}
        onChange={(e) => setConfirmation(e.target.value)}
        placeholder="DELETE"
        className="w-full font-mono"
        autoComplete="off"
      />
    </Modal>
  );
}
