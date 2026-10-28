import { useState } from "react";
import { readClientId } from "../api/spotify/storage.ts";

export function ClientIdDialog({
  onSave,
  onClose,
}: {
  onSave: (clientId: string) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState(() => readClientId());

  return (
    <div className="client-id-layer" role="presentation" onMouseDown={onClose}>
      <form
        className="client-id-dialog"
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          const clientId = value.trim();
          if (!clientId) return;
          onSave(clientId);
          onClose();
        }}
      >
        <h2>Client ID</h2>
        <p>
          Paste the Client ID from the Spotify app you just created. The login does not fill this
          in.
        </p>
        <label htmlFor="spotify-client-id">Client ID</label>
        <input
          id="spotify-client-id"
          name="clientId"
          value={value}
          autoFocus
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => setValue(event.target.value)}
        />
        <div className="client-id-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit">Save</button>
        </div>
      </form>
    </div>
  );
}
